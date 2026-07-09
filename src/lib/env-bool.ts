export function interpretEnvVarAsBool(val: unknown): boolean {
  if (typeof val !== 'string') return false
  return ['true', 'yes', '1', 'on'].includes(val.toLowerCase())
}
