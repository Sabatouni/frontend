import { ENV_STATUS } from "../config/environment";

// The admin backend holds the production service-role key, so its URL is
// only taken from the environment guard: staging is only ever allowed a
// local or explicitly "staging" admin backend (see src/config/envGuard.js).
// 🚨 Hard fail if the configuration was rejected or the URL is missing.
if (!ENV_STATUS.ok || !ENV_STATUS.apiUrl) {
  throw new Error(
    ENV_STATUS.ok
      ? "VITE_API_URL is not set. Fix it in Vercel environment variables."
      : `Admin API disabled: ${ENV_STATUS.appEnv} environment configuration was rejected.`
  );
}

// 🧹 Trailing slash already stripped by the guard
const BASE = ENV_STATUS.apiUrl;

console.log("✅ API BASE:", BASE);

export { BASE as API };
export const ADMIN_API = `${BASE}/admin`;
