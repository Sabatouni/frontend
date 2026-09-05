import { createClient } from "@supabase/supabase-js";
import cors from "cors";
import dotenv from "dotenv";
import express from "express";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

// Supabase Admin Client (service role) -- required for auth.admin.* calls
// (list/create/update/delete users, ban, password reset) which have no
// RLS-safe client-side equivalent. Every route below still gates on the
// caller's actual stv-pos role before doing anything with it.
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const APP_SLUG = "stv-pos";
const VALID_ROLES = ["worker", "admin", "owner"];

// Looks up the caller's *active* role on stv-pos directly from
// user_application_roles, via the service-role client (bypasses RLS, which
// is fine here since this server already fully trusts its own DB
// credentials -- the actual gate is the JWT verification above it).
// This replaces the old check against `user_metadata.role`, which was a
// value any client could ask Supabase to set on their own session and was
// never the real authorization boundary to begin with.
async function getStvPosRole(userId) {
  const { data, error } = await supabase
    .from("user_application_roles")
    .select("roles!inner(slug), applications!inner(slug)")
    .eq("user_id", userId)
    .eq("applications.slug", APP_SLUG)
    .is("revoked_at", null)
    .maybeSingle();
  if (error) throw error;
  return data?.roles?.slug || null;
}

// AUTH MIDDLEWARE -- requires an ADMIN or OWNER role on stv-pos specifically.
// A Worker, or an Owner/Admin of a *different* application (stv-web,
// numa-web, ulphoria-web, alie-web), gets 403 here.
async function requireAdmin(req, res, next) {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith("Bearer ")) {
      return res.status(401).json({ error: "Missing token" });
    }

    const token = authHeader.split(" ")[1];
    const { data, error } = await supabase.auth.getUser(token);

    if (error || !data?.user) {
      return res.status(401).json({ error: "Invalid token" });
    }

    const role = await getStvPosRole(data.user.id);
    if (!role || !["admin", "owner"].includes(role)) {
      return res.status(403).json({ error: "Not authorized — stv-pos owner/admin only" });
    }

    req.user = data.user;
    req.stvPosRole = role;
    next();
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

// ── GET all users (with their current stv-pos role, if any) ─────
app.get("/admin/users", requireAdmin, async (req, res) => {
  const { data, error } = await supabase.auth.admin.listUsers();
  if (error) return res.status(400).json({ error: error.message });

  const { data: grants, error: gErr } = await supabase
    .from("user_application_roles")
    .select("user_id, roles!inner(slug), applications!inner(slug)")
    .eq("applications.slug", APP_SLUG)
    .is("revoked_at", null);
  if (gErr) return res.status(400).json({ error: gErr.message });

  const roleByUser = Object.fromEntries((grants || []).map((g) => [g.user_id, g.roles.slug]));
  const users = data.users.map((u) => ({ ...u, stv_pos_role: roleByUser[u.id] || null }));
  res.json(users);
});

// ── CREATE user + grant their initial stv-pos role ───────────────
app.post("/admin/users", requireAdmin, async (req, res) => {
  const { email, password, role = "worker", name } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: "Email and password are required" });
  }
  const roleSlug = String(role).toLowerCase();
  if (!VALID_ROLES.includes(roleSlug)) {
    return res.status(400).json({ error: `Role must be one of: ${VALID_ROLES.join(", ")}` });
  }

  const { data, error } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { name: name || email.split("@")[0] },
  });

  if (error) return res.status(400).json({ error: error.message });

  // handle_new_auth_user() creates the matching public.profiles row
  // synchronously via trigger, so this grant can run immediately.
  const { error: grantErr } = await supabase.rpc("grant_application_role", {
    p_user_id: data.user.id,
    p_application_slug: APP_SLUG,
    p_role_slug: roleSlug,
  });

  if (grantErr) {
    // Creation + initial grant must be atomic from the caller's point of
    // view: a Supabase Auth account with no stv-pos grant is a user who can
    // sign in and land on "you don't have access", with no record on the
    // Users page explaining why (their stv_pos_role just reads null, same
    // as anyone who was deliberately revoked). Rather than returning a
    // partial-success response and hoping whoever reads it notices the
    // warning field (fetch() treats any 2xx, including 207, as ok -- a
    // frontend checking only res.ok would silently report this as a plain
    // "user created" success), we compensate by deleting the auth account
    // we just created and failing the whole request clearly.
    const { error: rollbackErr } = await supabase.auth.admin.deleteUser(data.user.id);
    if (rollbackErr) {
      // Couldn't even undo it -- this IS now a genuinely orphaned account.
      // Say so loudly rather than hiding it behind a 2xx status.
      return res.status(500).json({
        error: `Created ${email}, but granting ${roleSlug} access failed (${grantErr.message}) and automatic cleanup also failed (${rollbackErr.message}). This account needs manual review in Supabase.`,
      });
    }
    return res.status(400).json({
      error: `Could not grant ${roleSlug} access (${grantErr.message}), so the account was not created. Please try again.`,
    });
  }

  res.json({ ...data.user, stv_pos_role: roleSlug });
});

// ── CHANGE role (grant_application_role replaces any existing active
//    grant for this app atomically -- no separate revoke step needed) ──
app.patch("/admin/role", requireAdmin, async (req, res) => {
  const { userId, role } = req.body;
  const roleSlug = String(role || "").toLowerCase();
  if (!userId || !VALID_ROLES.includes(roleSlug)) {
    return res.status(400).json({ error: `userId is required and role must be one of: ${VALID_ROLES.join(", ")}` });
  }

  const { error } = await supabase.rpc("grant_application_role", {
    p_user_id: userId,
    p_application_slug: APP_SLUG,
    p_role_slug: roleSlug,
  });

  if (error) return res.status(400).json({ error: error.message });
  res.json({ message: "Role updated", role: roleSlug });
});

// ── REVOKE all stv-pos access (distinct from a role change) ──────
app.delete("/admin/role/:userId", requireAdmin, async (req, res) => {
  const { userId } = req.params;
  const { error } = await supabase.rpc("revoke_application_role", {
    p_user_id: userId,
    p_application_slug: APP_SLUG,
  });
  if (error) return res.status(400).json({ error: error.message });
  res.json({ message: "Access revoked" });
});

// ── ENABLE / DISABLE user ──────────────────────────────────────
app.patch("/admin/active", requireAdmin, async (req, res) => {
  const { userId, active } = req.body;

  const { data, error } = await supabase.auth.admin.updateUserById(userId, {
    ban_duration: active ? "none" : "876000h",
  });

  if (error) return res.status(400).json({ error: error.message });
  res.json(data);
});

// ── RESET password ─────────────────────────────────────────────
app.post("/admin/reset-password", requireAdmin, async (req, res) => {
  const { email } = req.body;

  const { data, error } = await supabase.auth.resetPasswordForEmail(email);
  if (error) return res.status(400).json({ error: error.message });
  res.json({ message: "Reset email sent" });
});

// ── DELETE user ────────────────────────────────────────────────
app.delete("/admin/users/:id", requireAdmin, async (req, res) => {
  const { id } = req.params;

  const { error } = await supabase.auth.admin.deleteUser(id);
  if (error) return res.status(400).json({ error: error.message });
  res.json({ message: "User deleted" });
});

// ── AI PERSONALIZATION (itinerary welcome copy) ──────────────────
// Rewrites/personalizes the guest-facing itinerary welcome paragraph from
// *only* the structured, already-verified fields the admin entered in the
// Swahili Tent Itinerary editor (guest name, guest type, occasion,
// accommodation, stay dates, party size, selected experience titles, and
// free-text preferences). The system prompt explicitly forbids inventing
// any fact that isn't present in that payload -- a missing field is simply
// left out of the paragraph, never guessed at. This route never touches
// the database and never sees anything beyond what the request body
// carries; it is gated by the same requireAdmin middleware (stv-pos
// Owner/Admin only) as every other route in this file.
//
// Provider is selected from whichever key is configured in *this server's*
// environment -- nothing is hardcoded here and no key is ever sent to the
// frontend. If neither is configured, this returns 501 so the client can
// fall back to the existing deterministic phrase-bank personalization
// (src/lib/itineraryContent.js buildWelcomeText) instead of failing.
//
//   ANTHROPIC_API_KEY  -- preferred provider (default model claude-3-5-haiku-latest)
//   OPENAI_API_KEY     -- fallback provider (default model gpt-4o-mini)
//   ITINERARY_AI_MODEL -- optional model override for whichever provider is used
const AI_SYSTEM_PROMPT = `You are a hospitality copywriter for Swahili Tent Village, a tented camp in Zanzibar, Tanzania. You write short, warm, natural guest-facing welcome paragraphs for personalized travel itineraries.

STRICT RULES -- follow all of them:
1. Use ONLY the facts given to you in the guest data below. Never invent a name, date, price, amenity, activity, or location that isn't present.
2. If a field is missing or empty, simply don't mention it -- never guess a replacement or write a placeholder.
3. Write 2-4 sentences of flowing prose (no headers, no bullet points, no markdown).
4. Match the tone to the guest type and occasion given (e.g. a couple's anniversary reads differently from a corporate retreat or a family trip).
5. Do not include a greeting line like "Dear X," -- that is added separately by the template.
6. Do not mention pricing, payment, or terms.
7. Always write out "Swahili Tent Village" in full. Never write "STV" -- that abbreviation is an internal-only code name and must never appear in guest-facing text.
8. Never suggest, imply, or invent an amenity, service, or complimentary touch (e.g. room decoration, a gift, a specific dish) unless it is explicitly present in the guest data below. You may organize and phrase what's given -- you may not add to it.

Return ONLY the paragraph text, nothing else.`;

async function callAnthropic(facts) {
  const model = process.env.ITINERARY_AI_MODEL || "claude-3-5-haiku-latest";
  const resp = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": process.env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model,
      max_tokens: 400,
      system: AI_SYSTEM_PROMPT,
      messages: [{ role: "user", content: `Guest data (JSON):\n${JSON.stringify(facts, null, 2)}` }],
    }),
  });
  const json = await resp.json();
  if (!resp.ok) throw new Error(json?.error?.message || `Anthropic API error (${resp.status})`);
  return json?.content?.[0]?.text || "";
}

async function callOpenAI(facts) {
  const model = process.env.ITINERARY_AI_MODEL || "gpt-4o-mini";
  const resp = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model,
      max_tokens: 400,
      messages: [
        { role: "system", content: AI_SYSTEM_PROMPT },
        { role: "user", content: `Guest data (JSON):\n${JSON.stringify(facts, null, 2)}` },
      ],
    }),
  });
  const json = await resp.json();
  if (!resp.ok) throw new Error(json?.error?.message || `OpenAI API error (${resp.status})`);
  return json?.choices?.[0]?.message?.content || "";
}

app.post("/admin/itinerary/personalize", requireAdmin, async (req, res) => {
  const {
    guestName, guestType, occasion, tentName, checkIn, checkOut,
    adults, children, preferences, experiences,
  } = req.body || {};

  const provider = process.env.ANTHROPIC_API_KEY ? "anthropic"
    : process.env.OPENAI_API_KEY ? "openai"
    : null;

  if (!provider) {
    return res.status(501).json({ error: "AI personalization is not configured on this server (no ANTHROPIC_API_KEY or OPENAI_API_KEY set)." });
  }

  // Only ever forward fields that are actually set -- an unset field must
  // not reach the model as `null`/`""`, which could read as "this guest has
  // no children" instead of "children wasn't asked about here".
  const facts = {
    guestName: guestName || undefined,
    guestType: guestType || undefined,
    occasion: occasion || undefined,
    accommodation: tentName || undefined,
    checkIn: checkIn || undefined,
    checkOut: checkOut || undefined,
    adults: adults ?? undefined,
    children: children ?? undefined,
    preferences: preferences || undefined,
    experiences: Array.isArray(experiences) && experiences.length ? experiences : undefined,
  };
  const cleanFacts = Object.fromEntries(Object.entries(facts).filter(([, v]) => v !== undefined));

  if (Object.keys(cleanFacts).length === 0) {
    return res.status(400).json({ error: "No guest data provided to personalize." });
  }

  try {
    const text = provider === "anthropic" ? await callAnthropic(cleanFacts) : await callOpenAI(cleanFacts);
    if (!text) throw new Error("Empty response from AI provider");
    res.json({ text: text.trim(), provider });
  } catch (err) {
    // Any AI-provider failure (network, auth, rate limit, malformed
    // response) is surfaced as a normal error response -- the frontend is
    // expected to fall back to deterministic personalization rather than
    // show the admin a hard failure.
    res.status(502).json({ error: `AI personalization failed: ${err.message}` });
  }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`🚀 Admin backend running on port ${PORT}`));
