/**
 * Proxy for Private Instance Mode (Issue #4)
 * Handles authentication and access control
 * Note: Migrated from middleware.ts for Next.js 16 compatibility
 */

import { interpretEnvVarAsBool } from '@/lib/env-bool'
import { buildHstsHeader } from '@/lib/hsts'
import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'

// Routes that don't require authentication even in private mode
const publicRoutes = [
  '/auth/signin',
  '/auth/error',
  '/auth/change-password',
  '/auth/verify-2fa',
  '/api/auth',
  '/api/health',
  '/api/trpc', // tRPC routes handle their own auth
]

// Routes that are always public (shared group access)
const sharedRoutes = ['/groups/'] // Group pages can be accessed via shared links

// Admin-only routes
const adminRoutes = ['/admin']

// HSTS is emitted at runtime (not baked into next build) so container.env /
// platform env vars control it. The header value (or null when disabled) is
// computed once at module load; an invalid HSTS_* value throws here (and,
// guaranteed at boot, in instrumentation.ts). See src/lib/hsts.ts for the env
// contract.
const hstsHeaderValue = buildHstsHeader()

/**
 * Attach runtime security headers (currently HSTS) to a response, mutating it
 * in place so the response's status, Location, cookies and existing headers
 * are preserved. Only responses for matcher-covered routes pass through the
 * proxy — static assets excluded by `config.matcher` (_next/static,
 * _next/image, favicon.ico) do not receive these headers, which is fine for
 * HSTS since the browser records the policy from any single response.
 */
export function withSecurityHeaders(response: NextResponse): NextResponse {
  if (hstsHeaderValue) {
    response.headers.set('Strict-Transport-Security', hstsHeaderValue)
  }
  return response
}

/**
 * Resolve the routing decision for a request and return a bare (unwrapped)
 * response. It stays out of withSecurityHeaders on purpose: proxy() is the
 * single exit point that adds security headers, so every branch here must
 * simply return a NextResponse and new branches belong in this function.
 */
function route(request: NextRequest): NextResponse {
  const { pathname } = request.nextUrl

  // Check if private instance mode is enabled
  const isPrivateInstance = interpretEnvVarAsBool(process.env.PRIVATE_INSTANCE)

  if (!isPrivateInstance) {
    // Public instance - block auth pages (they require SessionProvider)
    if (pathname.startsWith('/auth/') || pathname.startsWith('/admin')) {
      return NextResponse.redirect(new URL('/', request.url))
    }
    return NextResponse.next()
  }

  // Check if this is a public route
  const isPublicRoute = publicRoutes.some((prefix) =>
    pathname.startsWith(prefix),
  )
  if (isPublicRoute) {
    return NextResponse.next()
  }

  // Get session token from cookies
  const sessionToken =
    request.cookies.get('authjs.session-token')?.value ||
    request.cookies.get('__Secure-authjs.session-token')?.value

  // Group creation requires auth - check before sharedRoutes
  if (pathname === '/groups/create' && !sessionToken) {
    const signInUrl = new URL('/auth/signin', request.url)
    signInUrl.searchParams.set('callbackUrl', pathname)
    return NextResponse.redirect(signInUrl)
  }

  // Check if this is a shared group route (allow access without auth)
  const isSharedRoute = sharedRoutes.some((prefix) =>
    pathname.startsWith(prefix),
  )
  if (isSharedRoute) {
    // Allow shared group access without authentication
    // The group itself is protected by the encryption key in the URL
    return NextResponse.next()
  }

  // Check if this is a static file or API route that should be public
  if (
    pathname.startsWith('/_next') ||
    pathname.startsWith('/favicon') ||
    pathname.startsWith('/icon') ||
    pathname.startsWith('/apple-icon') ||
    pathname.endsWith('.png') ||
    pathname.endsWith('.ico') ||
    pathname.endsWith('.svg')
  ) {
    return NextResponse.next()
  }

  // Check admin routes - require session token
  if (adminRoutes.some((prefix) => pathname.startsWith(prefix))) {
    if (!sessionToken) {
      const signInUrl = new URL('/auth/signin', request.url)
      signInUrl.searchParams.set('callbackUrl', pathname)
      return NextResponse.redirect(signInUrl)
    }
    // Admin role (isAdmin) is verified in:
    // - Page component: src/app/admin/page.tsx (auth() + isAdmin check)
    // - API layer: src/app/api/admin/*/route.ts (session.user.isAdmin check)
    // JWT decoding in proxy is avoided to prevent NextAuth internal dependency
    return NextResponse.next()
  }

  return NextResponse.next()
}

// Every response must leave through withSecurityHeaders; add new branches
// inside route() only.
export async function proxy(request: NextRequest) {
  return withSecurityHeaders(route(request))
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     */
    '/((?!_next/static|_next/image|favicon.ico).*)',
  ],
}
