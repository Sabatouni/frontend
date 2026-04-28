import axios from "axios";

/**
 * In production (Vercel), set VITE_API_URL to your Railway backend URL:
 *   VITE_API_URL=https://swahili-pos-production.up.railway.app
 *
 * Locally, leave it unset — Vite's dev proxy forwards /api/* to localhost:8080.
 */
const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL ?? "",
  headers: {
    "Content-Type": "application/json",
  },
});

// Attach JWT on every request automatically
api.interceptors.request.use((config) => {
  const token = localStorage.getItem("jwt_token");
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// On 401, clear stored credentials and redirect to login
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      localStorage.removeItem("jwt_token");
      localStorage.removeItem("user");
      window.location.href = "/login";
    }
    return Promise.reject(error);
  }
);

export default api;