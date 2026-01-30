'use client'

import { useEffect } from 'react'

/**
 * Global error boundary for root layout errors
 * This component MUST render its own html and body tags
 * because it replaces the entire root layout when triggered
 *
 * Note: We use inline styles because Tailwind CSS may not be loaded
 * when this component renders (it replaces the entire document)
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error('Global application error:', error)
  }, [error])

  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>Error - anon-spliit</title>
        <style>{`
          @media (prefers-color-scheme: dark) {
            :root { color-scheme: dark; }
            body { background-color: #0a0a0a !important; color: #fafafa !important; }
            .error-icon-bg { background-color: #2a1a1a !important; }
            .error-detail { background-color: #1a1a1a !important; }
            .error-text { color: #a1a1aa !important; }
            .btn-secondary { border-color: #404040 !important; color: #e5e5e5 !important; }
            .btn-secondary:hover { background-color: #1a1a1a !important; }
          }
        `}</style>
      </head>
      <body
        style={{
          margin: 0,
          minHeight: '100vh',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '2rem',
          backgroundColor: '#f8fafc',
          fontFamily:
            '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
        }}
      >
        <div
          style={{
            maxWidth: '28rem',
            width: '100%',
            textAlign: 'center',
          }}
        >
          {/* Icon */}
          <div
            style={{
              display: 'flex',
              justifyContent: 'center',
              marginBottom: '1.5rem',
            }}
          >
            <div
              className="error-icon-bg"
              style={{
                borderRadius: '9999px',
                backgroundColor: '#fee2e2',
                padding: '1rem',
              }}
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="48"
                height="48"
                viewBox="0 0 24 24"
                fill="none"
                stroke="#dc2626"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="8" x2="12" y2="12" />
                <line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
            </div>
          </div>

          {/* Title and description */}
          <h1
            style={{
              fontSize: '1.5rem',
              fontWeight: 'bold',
              marginBottom: '0.5rem',
            }}
          >
            Something went wrong
          </h1>
          <p
            className="error-text"
            style={{
              color: '#6b7280',
              marginBottom: '1.5rem',
            }}
          >
            A critical error occurred. Please try refreshing the page.
          </p>

          {/* Error details (development only) */}
          {process.env.NODE_ENV === 'development' && error.message && (
            <div
              className="error-detail"
              style={{
                padding: '1rem',
                backgroundColor: '#f3f4f6',
                borderRadius: '0.5rem',
                textAlign: 'left',
                marginBottom: '1.5rem',
              }}
            >
              <p
                style={{
                  fontSize: '0.875rem',
                  fontFamily: 'monospace',
                  color: '#dc2626',
                  wordBreak: 'break-all',
                  margin: 0,
                }}
              >
                {error.message}
              </p>
              {error.digest && (
                <p
                  className="error-text"
                  style={{
                    fontSize: '0.75rem',
                    color: '#6b7280',
                    marginTop: '0.5rem',
                    marginBottom: 0,
                  }}
                >
                  Error ID: {error.digest}
                </p>
              )}
            </div>
          )}

          {/* Buttons */}
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: '0.75rem',
            }}
          >
            <button
              onClick={reset}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                padding: '0.5rem 1rem',
                backgroundColor: '#059669',
                color: 'white',
                borderRadius: '0.375rem',
                border: 'none',
                cursor: 'pointer',
                fontSize: '0.875rem',
                fontWeight: 500,
              }}
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                style={{ marginRight: '0.5rem' }}
              >
                <path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
                <path d="M3 3v5h5" />
                <path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16" />
                <path d="M16 21h5v-5" />
              </svg>
              Try again
            </button>
            <button
              onClick={() => (window.location.href = '/')}
              className="btn-secondary"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                padding: '0.5rem 1rem',
                backgroundColor: 'transparent',
                color: '#374151',
                borderRadius: '0.375rem',
                border: '1px solid #d1d5db',
                cursor: 'pointer',
                fontSize: '0.875rem',
                fontWeight: 500,
              }}
            >
              Go to home
            </button>
          </div>
        </div>
      </body>
    </html>
  )
}
