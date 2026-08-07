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
    // Don't hide this: the account exists but has no access yet.
    return res.status(207).json({
      warning: `User created, but the role grant failed (${grantErr.message}). Assign a role manually from the Users page.`,
      user: data.user,
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

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`🚀 Admin backend running on port ${PORT}`));
