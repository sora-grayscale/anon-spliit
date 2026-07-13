/**
 * HSTS (Strict-Transport-Security) header configuration.
 *
 * The header is emitted at RUNTIME from the Node.js proxy (src/proxy.ts), not
 * baked into `next build`. That is deliberate: `next.config.mjs` `headers()`
 * is evaluated at build time and frozen into `.next`, so a prebuilt Docker
 * image could never honor `container.env`. Emitting from the proxy lets
 * runtime env (container.env / platform env vars) actually control the header
 * — though it is not hot-reloaded, and re-reading changed env can be subtle: a
 * plain `docker compose up -d` or `restart` may not re-read an edited env_file,
 * so use `docker compose up -d --force-recreate` (podman compose likewise); on
 * Vercel, redeploy.
 *
 * The default deliberately omits `includeSubDomains`: it is a default that
 * does not affect subdomains, NOT a harmless one — the serving host itself is
 * still pinned to HTTPS for `max-age` seconds (2 years). Applying
 * `includeSubDomains` unconditionally would be dangerous on an apex domain:
 * one visit to https://example.com would force every subdomain (e.g. a
 * TLS-less http://legacy.example.com) to HTTPS for the full max-age, and
 * subdomains cannot undo the parent's policy (RFC 6797 §11.4). It is
 * therefore an explicit opt-in via environment variable.
 *
 * `preload` is intentionally not supported: the browser preload list is a
 * slow-to-reverse commitment and requires includeSubDomains anyway. Deployers
 * who want preloading should manage HSTS at the hosting layer
 * (HSTS_ENABLED=false).
 *
 * Environment variables (all optional):
 * - HSTS_ENABLED: set to false/no/0/off to make the app NOT send the header.
 *   On platforms that emit their own HSTS (e.g. Vercel) this delegates the
 *   header to the platform; it does not necessarily remove HSTS from the final
 *   response. Default: enabled.
 * - HSTS_MAX_AGE: policy lifetime in seconds, strict non-negative integer.
 *   Default: 63072000 (2 years). Note that 0 does NOT mean "off": the header
 *   `max-age=0` is still sent and instructs browsers to delete their stored
 *   HSTS policy for the host (rollback). Use HSTS_ENABLED=false to stop
 *   sending the header.
 * - HSTS_INCLUDE_SUBDOMAINS: set to true/yes/1/on to append
 *   `includeSubDomains`. Only do this after confirming that every subdomain
 *   is served over TLS. Default: off.
 *
 * Keep values bare: many env-file parsers do NOT strip inline trailing
 * comments, so `HSTS_MAX_AGE=63072000 # 2 years` is read literally (including
 * the ` # 2 years` suffix) and fails startup validation.
 *
 * Validation is unconditional: all three variables are parsed before the
 * enabled check, so an invalid value throws even when HSTS_ENABLED=false. This
 * prevents latent garbage from lying dormant and only surfacing when HSTS is
 * later re-enabled. The proxy evaluates this at module load and
 * instrumentation.ts re-validates at server startup, so a misconfiguration
 * fails loudly (fail-closed) instead of silently shipping a wrong policy.
 */

import { parseStrictEnvBool } from './env-bool'

const DEFAULT_MAX_AGE_SECONDS = 63072000 // 2 years

function parseMaxAgeEnv(raw: string | undefined): number {
  if (raw === undefined || raw === '') return DEFAULT_MAX_AGE_SECONDS
  if (!/^\d+$/.test(raw)) {
    throw new Error(
      `HSTS_MAX_AGE must be a non-negative integer number of seconds, got: ${JSON.stringify(raw)}`,
    )
  }
  const parsed = Number(raw)
  if (!Number.isSafeInteger(parsed)) {
    throw new Error(
      `HSTS_MAX_AGE is too large to be represented safely, got: ${JSON.stringify(raw)}`,
    )
  }
  return parsed
}

/**
 * Build the Strict-Transport-Security header value from the environment.
 *
 * All three HSTS_* variables are validated before the enabled check, so an
 * invalid value throws even when HSTS_ENABLED=false (fail-closed).
 *
 * @param env - environment to read from (defaults to process.env)
 * @returns the header value (e.g. `max-age=63072000`), or null when the app
 *   must not send the header (HSTS_ENABLED=false)
 * @throws on invalid environment values (fail-closed)
 */
export function buildHstsHeader(
  env: Record<string, string | undefined> = process.env,
): string | null {
  const enabled = parseStrictEnvBool('HSTS_ENABLED', env.HSTS_ENABLED, true)
  const maxAge = parseMaxAgeEnv(env.HSTS_MAX_AGE)
  const includeSubDomains = parseStrictEnvBool(
    'HSTS_INCLUDE_SUBDOMAINS',
    env.HSTS_INCLUDE_SUBDOMAINS,
    false,
  )

  if (!enabled) return null

  return `max-age=${maxAge}${includeSubDomains ? '; includeSubDomains' : ''}`
}
