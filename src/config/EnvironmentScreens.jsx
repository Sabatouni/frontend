/* Startup UI for the environment guard. Deliberately self-contained (no app
   theme / i18n / Supabase imports), so it renders even when the app itself
   is not allowed to load. */

export const STAGING_BANNER_HEIGHT = 30

export function StagingBanner({ supabaseRef }) {
  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        position: "fixed", top: 0, left: 0, right: 0, height: STAGING_BANNER_HEIGHT, zIndex: 2147483000,
        display: "flex", alignItems: "center", justifyContent: "center", gap: 10, padding: "0 12px",
        background: "repeating-linear-gradient(135deg, #B45309 0 14px, #92400E 14px 28px)",
        color: "#fff", fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, sans-serif",
        fontSize: 12.5, fontWeight: 800, letterSpacing: 0.6, textTransform: "uppercase",
        boxShadow: "0 2px 8px rgba(0,0,0,0.25)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
      }}
    >
      <span aria-hidden="true">⚠</span>
      <span>Staging — test data only — not the live POS</span>
      {supabaseRef && <span style={{ fontWeight: 600, opacity: 0.85, textTransform: "none" }}>({supabaseRef})</span>}
    </div>
  )
}

export function ConfigErrorScreen({ status }) {
  return (
    <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 20, background: "#FEF2F2", fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, sans-serif" }}>
      <div role="alert" style={{ maxWidth: 640, width: "100%", background: "#fff", border: "2px solid #B91C1C", borderRadius: 14, padding: "24px 26px", boxShadow: "0 10px 30px rgba(0,0,0,0.08)" }}>
        <h1 style={{ margin: "0 0 6px", fontSize: 20, color: "#991B1B" }}>Startup blocked: unsafe configuration</h1>
        <p style={{ margin: "0 0 14px", fontSize: 14, color: "#374151" }}>
          The <b>{status.appEnv}</b> configuration was rejected, so the POS did not connect to any database or admin server.
        </p>
        <ul style={{ margin: "0 0 16px", paddingLeft: 20, fontSize: 13.5, color: "#111827", lineHeight: 1.55 }}>
          {status.errors.map((e, i) => <li key={i}>{e}</li>)}
        </ul>
        <p style={{ margin: 0, fontSize: 12.5, color: "#6B7280" }}>
          Staging: copy <code>.env.staging.example</code> to <code>.env.staging</code>, fill in the STAGING project values, then run <code>npm run dev:staging</code>.
          Production: check the variables in <code>.env</code> / Vercel.
        </p>
      </div>
    </div>
  )
}
