import { validateEnvironment } from "./envGuard"

/**
 * Evaluated once at startup from Vite's env. Everything that talks to
 * Supabase or the admin backend reads its connection details from here --
 * never from import.meta.env directly -- so nothing can connect unless the
 * guard has passed.
 */
export const ENV_STATUS = validateEnvironment(import.meta.env)
export const IS_STAGING = ENV_STATUS.appEnv === "staging"

if (!ENV_STATUS.ok) {
  console.error(`[Environment] ${ENV_STATUS.appEnv} configuration rejected:\n- ${ENV_STATUS.errors.join("\n- ")}`)
}
