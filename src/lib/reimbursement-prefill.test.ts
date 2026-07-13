import {
  getReimbursementAmount,
  setReimbursementAmount,
} from './reimbursement-prefill'

describe('reimbursement-prefill', () => {
  it('returns null when nothing is stored', () => {
    expect(getReimbursementAmount('g1', 'a', 'b')).toBeNull()
  })

  it('round-trips a stored amount for the matching group/from/to', () => {
    setReimbursementAmount('g1', 'a', 'b', 1234)
    expect(getReimbursementAmount('g1', 'a', 'b')).toBe(1234)
  })

  it('keeps amounts separate per from/to pair', () => {
    setReimbursementAmount('g1', 'a', 'b', 100)
    setReimbursementAmount('g1', 'b', 'a', 200)
    expect(getReimbursementAmount('g1', 'a', 'b')).toBe(100)
    expect(getReimbursementAmount('g1', 'b', 'a')).toBe(200)
  })

  it('does not leak amounts across groups', () => {
    setReimbursementAmount('g1', 'a', 'b', 100)
    expect(getReimbursementAmount('g2', 'a', 'b')).toBeNull()
  })

  it('preserves 0 as a stored value rather than falling back to null', () => {
    setReimbursementAmount('g3', 'a', 'b', 0)
    expect(getReimbursementAmount('g3', 'a', 'b')).toBe(0)
  })
})
