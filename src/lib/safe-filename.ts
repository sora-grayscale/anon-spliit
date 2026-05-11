/**
 * Safe filename utilities for S3 upload (Issue #134)
 *
 * Prevents path traversal attacks by strictly validating file extensions
 * extracted from user-supplied filenames before using them in S3 keys.
 */

/**
 * Allowed file extensions for image uploads.
 * Must align with the client-side `accept` attribute on file inputs.
 */
export const ALLOWED_IMAGE_EXTENSIONS = ['jpg', 'jpeg', 'png'] as const
export type AllowedImageExtension = (typeof ALLOWED_IMAGE_EXTENSIONS)[number]

/**
 * Extract a safe, normalized file extension from a user-supplied filename.
 *
 * Defense against:
 * - Path traversal: `evil.jpg/../foo.html` produces an empty extension (no slashes leak)
 * - MIME spoofing: only whitelisted extensions are returned
 * - Unicode/control characters: only ASCII alphanumeric extensions are accepted
 *
 * @param filename - The user-supplied filename (may contain path separators or be malicious)
 * @returns The safe extension with leading dot (e.g. ".jpg"), or empty string if invalid
 */
export function getSafeImageExtension(filename: string): string {
  if (typeof filename !== 'string' || filename.length === 0) return ''

  // Strip any path components (handle both forward and back slashes)
  const basename = filename.split(/[/\\]/).pop() ?? ''

  // Extract extension: only alphanumeric, 1-10 chars after the final dot
  const match = basename.match(/\.([a-zA-Z0-9]{1,10})$/)
  if (!match) return ''

  const ext = match[1].toLowerCase()
  return (ALLOWED_IMAGE_EXTENSIONS as readonly string[]).includes(ext)
    ? `.${ext}`
    : ''
}
