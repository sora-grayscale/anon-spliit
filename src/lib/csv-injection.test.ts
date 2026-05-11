import { escapeCsvCell, escapeCsvRow } from './csv-injection'

describe('escapeCsvCell', () => {
  describe('dangerous prefixes (Issue #136)', () => {
    it('prepends single quote to cells starting with =', () => {
      expect(escapeCsvCell('=cmd|"/c calc"!A1')).toBe('\'=cmd|"/c calc"!A1')
      expect(escapeCsvCell('=SUM(A1:A2)')).toBe("'=SUM(A1:A2)")
    })

    it('prepends single quote to cells starting with +', () => {
      expect(escapeCsvCell('+1+1')).toBe("'+1+1")
    })

    it('prepends single quote to cells starting with -', () => {
      expect(escapeCsvCell('-2+3')).toBe("'-2+3")
    })

    it('prepends single quote to cells starting with @', () => {
      expect(escapeCsvCell('@SUM(A1)')).toBe("'@SUM(A1)")
    })

    it('prepends single quote to cells starting with tab', () => {
      expect(escapeCsvCell('\tmalicious')).toBe("'\tmalicious")
    })

    it('prepends single quote to cells starting with carriage return', () => {
      expect(escapeCsvCell('\rfoo')).toBe("'\rfoo")
    })
  })

  describe('benign values', () => {
    it('returns plain strings unchanged', () => {
      expect(escapeCsvCell('hello world')).toBe('hello world')
      expect(escapeCsvCell('1000')).toBe('1000')
      expect(escapeCsvCell('Coffee')).toBe('Coffee')
    })

    it('returns empty string unchanged', () => {
      expect(escapeCsvCell('')).toBe('')
    })

    it('preserves strings with dangerous chars not at the start', () => {
      expect(escapeCsvCell('a=b')).toBe('a=b')
      expect(escapeCsvCell('foo+bar')).toBe('foo+bar')
    })

    it('returns non-string values unchanged', () => {
      expect(escapeCsvCell(42)).toBe(42)
      expect(escapeCsvCell(null)).toBe(null)
      expect(escapeCsvCell(undefined)).toBe(undefined)
      expect(escapeCsvCell(true)).toBe(true)
      const d = new Date('2026-01-01')
      expect(escapeCsvCell(d)).toBe(d)
    })
  })

  describe('encrypted base64 strings (typical app payload)', () => {
    // Encrypted values start with the first base64 character of the version
    // byte (0x01 -> 'A' in URL-safe base64). They should not trigger escape.
    it('does not escape typical encrypted base64 starting with A', () => {
      expect(escapeCsvCell('AY8xK9z2vQR0aB7c')).toBe('AY8xK9z2vQR0aB7c')
    })
  })
})

describe('escapeCsvRow', () => {
  it('escapes string fields and preserves numeric ones', () => {
    const row = {
      title: '=cmd|calc',
      amount: 1000,
      currency: 'USD',
      malicious: '@SUM(A1)',
      empty: '',
      nullField: null,
    }
    expect(escapeCsvRow(row)).toEqual({
      title: "'=cmd|calc",
      amount: 1000,
      currency: 'USD',
      malicious: "'@SUM(A1)",
      empty: '',
      nullField: null,
    })
  })

  it('does not mutate the original row', () => {
    const row = { title: '=evil', amount: 5 }
    const escaped = escapeCsvRow(row)
    expect(row.title).toBe('=evil')
    expect(escaped.title).toBe("'=evil")
  })
})
