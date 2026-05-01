import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY;

const isValidHttpUrl = (s) => {
  if (!s || typeof s !== "string") return false;
  try {
    const u = new URL(s);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
};

let supabase = null;

if (isValidHttpUrl(url) && key) {
  try {
    supabase = createClient(url, key);
  } catch (err) {
    console.error("[Supabase] init failed:", err);
    supabase = null;
  }
} else {
  console.warn(
    "[Supabase] Missing or invalid env vars. Check VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in Vercel."
  );
}

export { supabase };