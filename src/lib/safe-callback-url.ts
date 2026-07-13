/**
 * Sanitize a user-supplied `callbackUrl` redirect target.
 *
 * The 2FA verification pages read `callbackUrl` from the query string and pass
 * it to `router.replace()` after a successful verification. Without validation
 * an attacker can craft `/auth/verify-2fa?callbackUrl=https://evil.example` and
 * bounce the user to an external site after login (open redirect / phishing).
 *
 * Only same-origin targets are allowed. Cross-origin absolute URLs
 * (`https://host`), protocol-relative URLs (`//host`) and backslash variants
 * that browsers normalize to protocol-relative (`/\host`) are rejected and
 * fall back to `/`. Tab/newline/carriage-return characters are stripped first
 * because browsers ignore them when parsing URLs, which would otherwise let
 * `\t//host` slip through the checks.
 *
 * Same-origin ABSOLUTE URLs are accepted and reduced to their path + query +
 * hash: Auth.js's default redirect callback normalizes relative callback URLs
 * to absolute form (`baseUrl + url`), so the standard
 * `/api/auth/signin?callbackUrl=/admin` flow hands the custom sign-in page an
 * absolute URL — rejecting it would strand the user on `/` after signing in.
 * This reduction needs the browser's own origin; on the server (no `window`)
 * absolute URLs are rejected (fail-closed).
 *
 * The `fallback` is held to the same rules, so a future caller cannot smuggle
 * an absolute URL through the fallback parameter; an unsafe fallback degrades
 * to `/`.
 */
function sanitize(raw: string | null | undefined): string | null {
  if (!raw) return null

  const normalized = raw.replace(/[\t\n\r]/g, '').replace(/\\/g, '/')

  if (typeof window !== 'undefined') {
    let parsed: URL | null = null
    try {
      parsed = new URL(normalized)
    } catch {
      // Not an absolute URL — evaluate it as a path below.
    }
    if (parsed) {
      if (parsed.origin !== window.location.origin) return null
      // Re-apply the path rules to the reduced form: a pathname like
      // '//evil.example' would otherwise reopen the protocol-relative hole.
      return sanitize(parsed.pathname + parsed.search + parsed.hash)
    }
  }

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
