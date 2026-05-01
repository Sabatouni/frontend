const BASE = (import.meta.env.VITE_API_BASE_URL || "http://localhost:8080").replace(/\/+$/, "");
const TOKEN_KEY = "stv_token";

export const tokenStore = {
  get: () => localStorage.getItem(TOKEN_KEY),
  set: (t) => localStorage.setItem(TOKEN_KEY, t),
  clear: () => localStorage.removeItem(TOKEN_KEY),
};

let onUnauthorized = null;
export const setUnauthorizedHandler = (fn) => { onUnauthorized = fn; };

async function request(path, { method = "GET", body, auth = true } = {}) {
  const headers = { "Content-Type": "application/json", Accept: "application/json" };
  const token = tokenStore.get();
  if (auth && token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body == null ? undefined : JSON.stringify(body),
  });

  if (res.status === 401 && auth) {
    tokenStore.clear();
    if (onUnauthorized) onUnauthorized();
    throw new Error("Session expired. Please log in again.");
  }

  const text = await res.text();
  const data = text ? JSON.parse(text) : null;

  if (!res.ok) {
    const msg = (data && (data.message || data.error)) || `Request failed (${res.status})`;
    const err = new Error(msg);
    err.status = res.status;
    err.fields = data?.fields;
    throw err;
  }
  return data;
}

export const api = {
  login:    (username, password) => request("/api/auth/login", { method: "POST", body: { username, password }, auth: false }),
  register: (payload) => request("/api/auth/register", { method: "POST", body: payload }),

  dashboard: () => request("/api/dashboard/summary"),

  listSales:   (page = 0, size = 50) => request(`/api/sales?page=${page}&size=${size}`),
  createSale:  (payload) => request("/api/sales", { method: "POST", body: payload }),
  deleteSale:  (id) => request(`/api/sales/${id}`, { method: "DELETE" }),

  listExpenses:  (page = 0, size = 50) => request(`/api/expenses?page=${page}&size=${size}`),
  createExpense: (payload) => request("/api/expenses", { method: "POST", body: payload }),
  deleteExpense: (id) => request(`/api/expenses/${id}`, { method: "DELETE" }),

  listProducts:  (activeOnly = true) => request(`/api/products?activeOnly=${activeOnly}`),
  createProduct: (payload) => request("/api/products", { method: "POST", body: payload }),
  updateProduct: (id, payload) => request(`/api/products/${id}`, { method: "PUT", body: payload }),
  deleteProduct: (id) => request(`/api/products/${id}`, { method: "DELETE" }),

  listUsers:        () => request("/api/users"),
  setUserActive:    (id, active) => request(`/api/users/${id}/active`, { method: "PATCH", body: { active } }),
  setUserRole:      (id, role) => request(`/api/users/${id}/role`, { method: "PATCH", body: { role } }),
  resetUserPassword:(id, password) => request(`/api/users/${id}/reset-password`, { method: "POST", body: { password } }),
};