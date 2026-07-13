import createNextIntlPlugin from 'next-intl/plugin'

const withNextIntl = createNextIntlPlugin()

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
            // Enforce HTTPS for two years once seen over TLS. `preload` is
            // intentionally omitted so self-hosters are not forced onto the
            // browser preload list (a slow-to-reverse commitment). Ignored by
            // browsers over plain HTTP, so local/dev HTTP is unaffected.
            // Full CSP is tracked separately in #194.
            key: 'Strict-Transport-Security',
            value: 'max-age=63072000; includeSubDomains',
          },
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
