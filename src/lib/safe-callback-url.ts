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
 */
export function sanitizeCallbackUrl(
  raw: string | null | undefined,
  fallback: string = '/',
): string {
  if (!raw) return fallback

  const normalized = raw.replace(/[\t\n\r]/g, '').replace(/\\/g, '/')

  // Must be a single-slash absolute path rooted at our own origin.
  if (!normalized.startsWith('/') || normalized.startsWith('//')) {
    return fallback
  }

  return normalized
}
