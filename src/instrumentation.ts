import { buildHstsHeader } from '@/lib/hsts'

/**
 * Next.js calls `register()` once at server startup. We validate the HSTS_*
 * environment here so a misconfiguration fails loudly at boot (fail-closed),
 * rather than only surfacing on the first request that reaches the proxy
 * (module-level evaluation in src/proxy.ts can be lazy).
 */
export function register() {
  // Throws on invalid HSTS_* values; the return value is unused here.
  buildHstsHeader()
}
