/**
 * CSV Injection (formula injection) prevention helpers (Issue #136)
 *
 * Spreadsheet applications (Excel, LibreOffice Calc, Google Sheets) may
 * interpret cells whose first character is one of `=`, `+`, `-`, `@`,
 * `\t`, or `\r` as formulas or commands. If user-controlled strings are
 * exported verbatim to CSV, opening the file can trigger code execution
 * or data exfiltration via spreadsheet features (e.g. `=cmd|'...'`).
 *
 * Mitigation: prepend a single quote (`'`) to any value that starts with
 * one of these characters. The quote is the standard "text override"
 * marker recognized by major spreadsheet applications.
 *
 * Reference: OWASP "CSV Injection" page.
 */

const DANGEROUS_PREFIX_CHARS = new Set(['=', '+', '-', '@', '\t', '\r'])

/**
 * Escape a single CSV cell value to prevent formula injection.
 * Returns non-string values unchanged.
 */
export function escapeCsvCell<T>(value: T): T | string {
  if (typeof value !== 'string' || value.length === 0) return value
  if (DANGEROUS_PREFIX_CHARS.has(value[0])) {
    return `'${value}`
  }
  return value
}

/**
 * Return a shallow copy of `row` with every string field escaped.
 */
export function escapeCsvRow<T extends Record<string, unknown>>(row: T): T {
  const result: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(row)) {
    result[key] = escapeCsvCell(value)
  }
  return result as T
}
