const API = import.meta.env.VITE_API_URL;

// 🚨 Hard fail if missing
if (!API) {
  throw new Error(
    "VITE_API_URL is not set. Fix it in Vercel environment variables."
  );
}

// 🧹 Clean trailing slash
const BASE = API.replace(/\/+$/, "");

console.log("✅ API BASE:", BASE);

export { BASE as API };
export const ADMIN_API = `${BASE}/admin`;