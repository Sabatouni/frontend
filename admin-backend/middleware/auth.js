import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export async function requireAdmin(req, res, next) {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({ error: "Missing token" });
    }

    const token = authHeader.split(" ")[1];

    // 🔍 Verify user
    const { data: userData, error } = await supabase.auth.getUser(token);

    if (error || !userData?.user) {
      return res.status(401).json({ error: "Invalid token" });
    }

    const user = userData.user;

    // 🔒 Check role
    if (user.user_metadata?.role !== "ADMIN") {
      return res.status(403).json({ error: "Not authorized" });
    }

    req.user = user;
    next();
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}