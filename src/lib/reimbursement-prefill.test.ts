import {
  clearReimbursementAmount,
  getReimbursementAmount,
  setReimbursementAmount,
} from './reimbursement-prefill'

// Every test uses its own unique key triple so cases never depend on the
// module-level map being cleared between them or on execution order.
describe('reimbursement-prefill', () => {
  it('returns null when nothing is stored for the key', () => {
    expect(getReimbursementAmount('none-g', 'none-a', 'none-b')).toBeNull()
  })

  it('round-trips a stored amount for the matching group/from/to', () => {
    setReimbursementAmount('rt-g', 'rt-a', 'rt-b', 1234)
    expect(getReimbursementAmount('rt-g', 'rt-a', 'rt-b')).toBe(1234)
  })

  it('keeps amounts separate per from/to pair', () => {
    setReimbursementAmount('pair-g', 'pair-a', 'pair-b', 100)
    setReimbursementAmount('pair-g', 'pair-b', 'pair-a', 200)
    expect(getReimbursementAmount('pair-g', 'pair-a', 'pair-b')).toBe(100)
    expect(getReimbursementAmount('pair-g', 'pair-b', 'pair-a')).toBe(200)
  })

  it('does not leak amounts across groups', () => {
    setReimbursementAmount('grp-a', 'x', 'y', 100)
    expect(getReimbursementAmount('grp-b', 'x', 'y')).toBeNull()
  })

  it('preserves 0 as a stored value rather than falling back to null', () => {
    setReimbursementAmount('zero-g', 'zero-a', 'zero-b', 0)
    expect(getReimbursementAmount('zero-g', 'zero-a', 'zero-b')).toBe(0)
  })

  it('clears a stored amount', () => {
    setReimbursementAmount('clr-g', 'clr-a', 'clr-b', 500)
    clearReimbursementAmount('clr-g', 'clr-a', 'clr-b')
    expect(getReimbursementAmount('clr-g', 'clr-a', 'clr-b')).toBeNull()
  })

  it('does not collide when ids contain the delimiter character', () => {
    // Both triples flatten to the same 'g:a:b:c' under a naive ':' join, so
    // this fails against a delimiter-joined key scheme.
    setReimbursementAmount('g', 'a:b', 'c', 1)
    setReimbursementAmount('g:a', 'b', 'c', 2)
    expect(getReimbursementAmount('g', 'a:b', 'c')).toBe(1)
    expect(getReimbursementAmount('g:a', 'b', 'c')).toBe(2)
  })
})
