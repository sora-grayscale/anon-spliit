/**
 * Sanitize a user-supplied `callbackUrl` redirect target.
 *
 * The 2FA verification pages read `callbackUrl` from the query string and pass
 * it to `router.replace()` after a successful verification. Without validation
 * an attacker can craft `/auth/verify-2fa?callbackUrl=https://evil.example` and
 * bounce the user to an external site after login (open redirect / phishing).
 *
 * Only same-origin absolute paths are allowed. Absolute URLs (`https://host`),
 * protocol-relative URLs (`//host`) and backslash variants that browsers
 * normalize to protocol-relative (`/\host`) are rejected and fall back to `/`.
 * Tab/newline/carriage-return characters are stripped first because browsers
 * ignore them when parsing URLs, which would otherwise let `\t//host` slip
 * through the checks.
 *
 * The `fallback` is held to the same rules, so a future caller cannot smuggle
 * an absolute URL through the fallback parameter; an unsafe fallback degrades
 * to `/`.
 */
function sanitize(raw: string | null | undefined): string | null {
  if (!raw) return null

  const normalized = raw.replace(/[\t\n\r]/g, '').replace(/\\/g, '/')

  // Must be a single-slash absolute path rooted at our own origin.
  if (!normalized.startsWith('/') || normalized.startsWith('//')) {
    return null
  }

  return normalized
}

export function sanitizeCallbackUrl(
  raw: string | null | undefined,
  fallback: string = '/',
): string {
  return sanitize(raw) ?? sanitize(fallback) ?? '/'
}
