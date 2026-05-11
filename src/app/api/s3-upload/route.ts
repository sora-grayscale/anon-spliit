import { randomId } from '@/lib/api'
import { auth } from '@/lib/auth'
import { env } from '@/lib/env'
import { getSafeImageExtension } from '@/lib/safe-filename'
import { checkRateLimit } from '@/lib/rate-limit'
import { POST as s3Route } from 'next-s3-upload/route'
import { NextRequest, NextResponse } from 'next/server'

// Allowed MIME types for uploads
const ALLOWED_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'image/avif',
  'application/pdf',
]

// Maximum file size: 5MB
const MAX_FILE_SIZE = 5 * 1024 * 1024

// Configure the S3 upload handler
const s3Handler = s3Route.configure({
  key(req, filename) {
    // Use a strict whitelist-based extension extractor to prevent path
    // traversal and MIME spoofing via crafted filenames (Issue #134).
    // Invalid filenames result in no extension; the client UI restricts
    // selections to images, so legitimate uploads are unaffected.
    const extension = getSafeImageExtension(filename)
    const timestamp = new Date().toISOString()
    const random = randomId()
    return `document-${timestamp}-${random}${extension}`
  },
  endpoint: env.S3_UPLOAD_ENDPOINT,
  // forcing path style is only necessary for providers other than AWS
  forcePathStyle: !!env.S3_UPLOAD_ENDPOINT,
})

/**
 * S3 Upload handler with authentication for Private Instance Mode (Issue #57)
 *
 * In private instance mode, users must be authenticated to upload files.
 * In public mode, uploads are allowed without authentication (groups are
 * protected by encryption keys in URLs).
 */
export async function POST(request: NextRequest) {
  // Check if private instance mode is enabled
  if (env.PRIVATE_INSTANCE) {
    const session = await auth()
    if (!session?.user) {
      return NextResponse.json(
        { error: 'Authentication required for file uploads' },
        { status: 401 },
      )
    }
  }

  // Rate limit: 10 uploads per minute per IP for public instances
  if (!env.PRIVATE_INSTANCE) {
    const ip = request.headers.get('x-forwarded-for') || 'unknown'
    const { allowed } = await checkRateLimit(`s3-upload:${ip}`, 10, 60)
    if (!allowed) {
      return NextResponse.json(
        { error: 'Too many uploads. Please try again later.' },
        { status: 429 },
      )
    }
  }

  // Validate Content-Type
  const contentType = request.headers.get('content-type') || ''
  if (!ALLOWED_MIME_TYPES.some((t) => contentType.startsWith(t))) {
    return NextResponse.json(
      { error: `File type not allowed. Accepted: ${ALLOWED_MIME_TYPES.join(', ')}` },
      { status: 400 },
    )
  }

  // Validate file size
  const contentLength = parseInt(request.headers.get('content-length') || '0', 10)
  if (contentLength > MAX_FILE_SIZE) {
    return NextResponse.json(
      { error: `File too large. Maximum size is ${MAX_FILE_SIZE / (1024 * 1024)}MB.` },
      { status: 400 },
    )
  }

  // Delegate to the S3 upload handler
  return s3Handler(request)
}
