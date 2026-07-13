import createNextIntlPlugin from 'next-intl/plugin'

const withNextIntl = createNextIntlPlugin()

// NOTE: HSTS is intentionally NOT set here. `headers()` is evaluated at build
// time and frozen into `.next`, so a prebuilt image (Docker/Vercel) could not
// honor runtime env (container.env). HSTS is emitted at runtime from the proxy
// instead — see src/lib/hsts.ts and src/proxy.ts. Full CSP is tracked in #194.

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Required to run in a codespace (see https://github.com/vercel/next.js/issues/58019)
  experimental: {
    serverActions: {
      allowedOrigins: ['localhost:3000'],
    },
  },
  // Security headers (Issue #125)
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          {
            key: 'X-Frame-Options',
            value: 'DENY',
          },
          {
            key: 'X-Content-Type-Options',
            value: 'nosniff',
          },
          {
            key: 'Referrer-Policy',
            value: 'strict-origin-when-cross-origin',
          },
          {
            key: 'Permissions-Policy',
            value: 'camera=(), microphone=(), geolocation=()',
          },
        ],
      },
    ]
  },
}

export default withNextIntl(nextConfig)
