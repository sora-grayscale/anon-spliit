// Shared truthy/falsy tokens for env-var boolean parsing. interpretEnvVarAsBool
// only consults TRUE_TOKENS (anything else, typos included, reads as false),
// while parseStrictEnvBool also recognizes FALSE_TOKENS and rejects the rest.
export const TRUE_TOKENS = ['true', 'yes', '1', 'on']
export const FALSE_TOKENS = ['false', 'no', '0', 'off']

export function interpretEnvVarAsBool(val: unknown): boolean {
  if (typeof val !== 'string') return false
  return TRUE_TOKENS.includes(val.toLowerCase())
}

/**
 * Strict boolean parser for env vars. In contrast to interpretEnvVarAsBool
 * (lenient / fail-open: any non-truthy value, including a typo, reads as
 * false), this throws when the value is neither a known truthy nor falsy
 * token, so a misconfigured flag fails loudly instead of silently taking a
 * default. Which parser a given env var uses is a deliberate per-variable
 * choice (e.g. PRIVATE_INSTANCE stays lenient; HSTS_* are strict).
 *
 * @param name - env var name, used in the thrown message
 * @param raw - raw value (undefined or '' yields defaultValue)
 * @param defaultValue - value returned when unset
 * @throws when raw is a non-empty value in neither token list
 */
export function parseStrictEnvBool(
  name: string,
  raw: string | undefined,
  defaultValue: boolean,
): boolean {
  if (raw === undefined || raw === '') return defaultValue
  const lowered = raw.toLowerCase()
  if (TRUE_TOKENS.includes(lowered)) return true
  if (FALSE_TOKENS.includes(lowered)) return false
  throw new Error(
    `${name} must be one of ${[...TRUE_TOKENS, ...FALSE_TOKENS].join('/')}, got: ${JSON.stringify(raw)}`,
  )
}
