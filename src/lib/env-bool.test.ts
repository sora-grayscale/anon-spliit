import { interpretEnvVarAsBool, parseStrictEnvBool } from './env-bool'

describe('interpretEnvVarAsBool (lenient / fail-open)', () => {
  it('accepts the truthy tokens case-insensitively', () => {
    for (const val of ['true', 'TRUE', 'yes', '1', 'on', 'On']) {
      expect(interpretEnvVarAsBool(val)).toBe(true)
    }
  })

  it('reads anything else as false, including typos and non-strings', () => {
    for (const val of ['false', 'off', '0', 'enabled', '', undefined, 1]) {
      expect(interpretEnvVarAsBool(val)).toBe(false)
    }
  })
})

describe('parseStrictEnvBool (strict / fail-closed)', () => {
  it('returns the default when unset or empty', () => {
    expect(parseStrictEnvBool('X', undefined, true)).toBe(true)
    expect(parseStrictEnvBool('X', undefined, false)).toBe(false)
    expect(parseStrictEnvBool('X', '', true)).toBe(true)
  })

  it('recognizes truthy and falsy tokens case-insensitively', () => {
    for (const val of ['true', 'YES', '1', 'on']) {
      expect(parseStrictEnvBool('X', val, false)).toBe(true)
    }
    for (const val of ['false', 'No', '0', 'OFF']) {
      expect(parseStrictEnvBool('X', val, true)).toBe(false)
    }
  })

  it('throws on unknown tokens, naming the variable', () => {
    expect(() => parseStrictEnvBool('MY_FLAG', 'enabled', true)).toThrow(
      /MY_FLAG/,
    )
    expect(() => parseStrictEnvBool('MY_FLAG', 'banana', false)).toThrow(
      /true\/yes\/1\/on\/false\/no\/0\/off/,
    )
  })
})
