import { randomId } from '@/lib/api'
import { auth } from '@/lib/auth'
import { env } from '@/lib/env'
import { getSafeImageExtension } from '@/lib/safe-filename'
import { POST as s3Route } from 'next-s3-upload/route'
import { NextRequest, NextResponse } from 'next/server'

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

  // Delegate to the S3 upload handler
  return s3Handler(request)
}
