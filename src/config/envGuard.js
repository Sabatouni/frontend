/**
 * Environment guard -- decides, BEFORE any Supabase or admin-backend code is
 * loaded, whether this build is allowed to start.
 *
 * Why this exists: Vite merges env files. In `--mode staging` it loads
 * `.env` first and then `.env.staging` on top, so any variable MISSING from
 * `.env.staging` silently falls back to the production value in `.env`.
 * Every rule below is written so that such a fallback is detected and the
 * app refuses to start, instead of quietly sending staging test data to the
 * live POS.
 *
 * Pure function (no import.meta, no side effects) so it can be unit tested.
 */

/** The live Swahili Tent Village POS project. Not a secret -- it is already
 * part of the public Supabase URL shipped in every production bundle. */
export const PRODUCTION_SUPABASE_REF = "nceyjgayttsaozfqiwtj"

const REF_RE = /^[a-z0-9]{20}$/
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"])

function parseUrl(value) {
  try {
    const u = new URL(String(value || "").trim())
    return u.protocol === "http:" || u.protocol === "https:" ? u : null
  } catch {
    return null
  }
}

/** Reads the `ref` claim of a legacy JWT anon key, or null (e.g. for the
 * newer sb_publishable_ keys, which carry no project reference). */
export function jwtProjectRef(key) {
  const parts = String(key || "").split(".")
  if (parts.length !== 3) return null
  try {
    const b64 = parts[1].replace(/-/g, "+").replace(/_/g, "/")
    const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4)
    const json = typeof atob === "function"
      ? atob(padded)
      : Buffer.from(padded, "base64").toString("utf8")
    const payload = JSON.parse(json)
    return typeof payload.ref === "string" ? payload.ref : null
  } catch {
    return null
  }
}

function hostRef(url) {
  const m = /^([a-z0-9]{20})\.supabase\.co$/.exec(url?.hostname || "")
  return m ? m[1] : null
}

/**
 * @param {Record<string,string|undefined>} env  import.meta.env (or a test object)
 * @returns {{ ok: boolean, appEnv: "staging"|"production", errors: string[],
 *             supabaseUrl?: string, supabaseAnonKey?: string, apiUrl?: string,
 *             supabaseRef?: string }}
 */
export function validateEnvironment(env = {}) {
  const errors = []
  const mode = String(env.MODE || "").trim()
  const appEnvRaw = String(env.VITE_APP_ENV || "").trim()
  const expectedRef = String(env.VITE_EXPECTED_SUPABASE_REF || "").trim()
  const urlRaw = String(env.VITE_SUPABASE_URL || "").trim()
  const anonKey = String(env.VITE_SUPABASE_ANON_KEY || "").trim()
  const apiRaw = String(env.VITE_API_URL || "").trim()

  const isStaging = mode === "staging" || appEnvRaw === "staging"
  const appEnv = isStaging ? "staging" : "production"
  const url = parseUrl(urlRaw)
  const api = parseUrl(apiRaw)
  const keyRef = jwtProjectRef(anonKey)

  if (isStaging) {
    // ── STAGING ──────────────────────────────────────────────────────
    if (mode !== "staging") {
      errors.push(`VITE_APP_ENV is "staging" but the build mode is "${mode || "unknown"}". Use "npm run dev:staging" / "npm run build:staging".`)
    }
    if (appEnvRaw !== "staging") {
      errors.push('Staging mode requires VITE_APP_ENV=staging in .env.staging (the file is missing or incomplete).')
    }

    const isLocal = expectedRef === "local"
    if (!expectedRef) {
      errors.push("VITE_EXPECTED_SUPABASE_REF is missing from .env.staging.")
    } else if (expectedRef === PRODUCTION_SUPABASE_REF) {
      errors.push("VITE_EXPECTED_SUPABASE_REF is the PRODUCTION project. Staging must use its own project.")
    } else if (!isLocal && !REF_RE.test(expectedRef)) {
      errors.push('VITE_EXPECTED_SUPABASE_REF must be a 20-character Supabase project reference (or "local" for a local Supabase).')
    }

    if (!urlRaw) {
      errors.push("VITE_SUPABASE_URL is missing from .env.staging.")
    } else if (!url) {
      errors.push("VITE_SUPABASE_URL is not a valid http(s) URL.")
    } else if (urlRaw.includes(PRODUCTION_SUPABASE_REF) || hostRef(url) === PRODUCTION_SUPABASE_REF) {
      errors.push("VITE_SUPABASE_URL points to the PRODUCTION database. Staging must never use it.")
    } else if (isLocal) {
      if (!LOCAL_HOSTS.has(url.hostname)) errors.push('With VITE_EXPECTED_SUPABASE_REF=local, VITE_SUPABASE_URL must be a localhost address.')
    } else if (expectedRef && url.hostname !== `${expectedRef}.supabase.co`) {
      errors.push(`VITE_SUPABASE_URL (${url.hostname}) does not match VITE_EXPECTED_SUPABASE_REF (${expectedRef}.supabase.co).`)
    } else if (url.protocol !== "https:") {
      errors.push("VITE_SUPABASE_URL must use https for a hosted staging project.")
    }

    if (!anonKey) {
      errors.push("VITE_SUPABASE_ANON_KEY is missing from .env.staging.")
    } else if (keyRef === PRODUCTION_SUPABASE_REF) {
      errors.push("VITE_SUPABASE_ANON_KEY belongs to the PRODUCTION project (it was probably inherited from .env). Add the staging key to .env.staging.")
    } else if (keyRef && !isLocal && expectedRef && keyRef !== expectedRef) {
      errors.push(`VITE_SUPABASE_ANON_KEY belongs to project ${keyRef}, not the expected staging project ${expectedRef}.`)
    }

    // The admin backend holds the PRODUCTION service-role key, so staging may
    // only talk to a local or explicitly staging admin backend.
    if (!apiRaw) {
      errors.push("VITE_API_URL is missing from .env.staging (use http://localhost:3002 if there is no staging admin backend).")
    } else if (!api) {
      errors.push("VITE_API_URL is not a valid http(s) URL.")
    } else if (!LOCAL_HOSTS.has(api.hostname) && !api.hostname.toLowerCase().includes("staging")) {
      errors.push(`VITE_API_URL (${api.hostname}) is not a local or staging admin backend. It was probably inherited from the production .env.`)
    }
  } else {
    // ── PRODUCTION (and normal `npm run dev`, which uses .env) ─────────
    if (appEnvRaw && appEnvRaw !== "production") {
      errors.push(`VITE_APP_ENV is "${appEnvRaw}" in a production build. Remove it or set it to "production".`)
    }
    if (expectedRef && expectedRef !== PRODUCTION_SUPABASE_REF) {
      errors.push("VITE_EXPECTED_SUPABASE_REF is set to a non-production project in a production build (staging settings leaked into production).")
    }
    if (!urlRaw) {
      errors.push("VITE_SUPABASE_URL is not set.")
    } else if (!url) {
      errors.push("VITE_SUPABASE_URL is not a valid http(s) URL.")
    } else if (hostRef(url) !== PRODUCTION_SUPABASE_REF) {
      errors.push(`Production is configured with a non-production database (${url.hostname}). Refusing to start.`)
    }
    if (!anonKey) {
      errors.push("VITE_SUPABASE_ANON_KEY is not set.")
    } else if (keyRef && keyRef !== PRODUCTION_SUPABASE_REF) {
      errors.push(`VITE_SUPABASE_ANON_KEY belongs to project ${keyRef}, not production. Refusing to start.`)
    }
    if (!apiRaw) {
      errors.push("VITE_API_URL is not set.")
    } else if (!api) {
      errors.push("VITE_API_URL is not a valid http(s) URL.")
    }
  }

  const ok = errors.length === 0
  return {
    ok,
    appEnv,
    errors,
    ...(ok ? {
      supabaseUrl: urlRaw,
      supabaseAnonKey: anonKey,
      apiUrl: apiRaw.replace(/\/+$/, ""),
      supabaseRef: appEnv === "staging" ? expectedRef : PRODUCTION_SUPABASE_REF,
    } : {}),
  }
}
