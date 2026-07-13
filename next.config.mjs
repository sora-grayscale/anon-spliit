import createNextIntlPlugin from 'next-intl/plugin'
import { buildHstsHeader } from './hsts.config.mjs'

const withNextIntl = createNextIntlPlugin()

// Evaluated at config load time so invalid HSTS_* values fail the build.
// See hsts.config.mjs for the env contract and the reasoning behind the
// subdomain-unaffecting default (full CSP is tracked separately in #194).
const hstsHeader = buildHstsHeader(process.env)

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
          ...(hstsHeader ? [hstsHeader] : []),
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
