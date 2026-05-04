const API = import.meta.env.VITE_API_URL;

if (!API) {
  console.error("⚠️  VITE_API_URL is not set. Add it to your .env file.");
}

console.log("API BASE:", API);

export { API };
export const ADMIN_API = `${API}/admin`;
