import { createClient } from "@supabase/supabase-js";
import cors from "cors";
import dotenv from "dotenv";
import express from "express";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

// 🔐 Supabase Admin Client (service role)
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

//
// 🔒 AUTH MIDDLEWARE
//
async function requireAdmin(req, res, next) {
  try {
    const authHeader = req.headers.authorization;

    // ❌ No token
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({ error: "Missing token" });
    }

    const token = authHeader.split(" ")[1];

    // 🔍 Verify user with Supabase
    const { data, error } = await supabase.auth.getUser(token);

    if (error || !data?.user) {
      return res.status(401).json({ error: "Invalid token" });
    }

    const user = data.user;

    // 🔒 Check ADMIN role
    if (user.user_metadata?.role !== "ADMIN") {
      return res.status(403).json({ error: "Not authorized" });
    }

    req.user = user;
    next();
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

// ==========================
// 🔹 GET USERS (PROTECTED)
// ==========================
app.get("/admin/users", requireAdmin, async (req, res) => {
  const { data, error } = await supabase.auth.admin.listUsers();

  if (error) return res.status(400).json({ error: error.message });

  res.json(data.users);
});

// ==========================
// 🔹 CHANGE ROLE (PROTECTED)
// ==========================
app.patch("/admin/role", requireAdmin, async (req, res) => {
  const { userId, role } = req.body;

  const { data, error } = await supabase.auth.admin.updateUserById(userId, {
    user_metadata: { role },
  });

  if (error) return res.status(400).json({ error: error.message });

  res.json(data);
});

// ==========================
// 🔹 ENABLE / DISABLE USER (PROTECTED)
// ==========================
app.patch("/admin/active", requireAdmin, async (req, res) => {
  const { userId, active } = req.body;

  const { data, error } = await supabase.auth.admin.updateUserById(userId, {
    ban_duration: active ? "none" : "876000h",
  });

  if (error) return res.status(400).json({ error: error.message });

  res.json(data);
});

// ==========================
// 🔹 RESET PASSWORD (PROTECTED)
// ==========================
app.post("/admin/reset-password", requireAdmin, async (req, res) => {
  const { email } = req.body;

  const { data, error } = await supabase.auth.resetPasswordForEmail(email);

  if (error) return res.status(400).json({ error: error.message });

  res.json({ message: "Reset email sent" });
});

// ==========================
const PORT = process.env.PORT || 3001;

app.listen(PORT, () => {
  console.log(`🚀 Admin backend running on port ${PORT}`);
});