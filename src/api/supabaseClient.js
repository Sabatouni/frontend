import { createClient } from "@supabase/supabase-js";
import { ENV_STATUS } from "../config/environment";

// Connection details come ONLY from the environment guard (see
// src/config/envGuard.js). If the guard rejected the configuration -- e.g.
// staging pointing at the production database, production pointing at the
// staging database, or a staging variable silently inherited from the
// production .env -- no client is created at all, so no request can leave
// this browser. main.jsx shows the configuration error screen instead of the
// app in that case; this check is the second layer.
let supabase = null;

if (ENV_STATUS.ok) {
  try {
    supabase = createClient(ENV_STATUS.supabaseUrl, ENV_STATUS.supabaseAnonKey);
  } catch (err) {
    console.error("[Supabase] init failed:", err);
    supabase = null;
  }
} else {
  console.error("[Supabase] Not initialised: environment configuration was rejected.");
}

export { supabase };
