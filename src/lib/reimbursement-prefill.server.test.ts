/** @jest-environment node */

import {
  getReimbursementAmount,
  setReimbursementAmount,
} from './reimbursement-prefill'

describe('reimbursement-prefill on the server (no window)', () => {
  it('ignores writes so plaintext amounts never enter shared process memory', () => {
    setReimbursementAmount('srv-g', 'srv-a', 'srv-b', 999)
    expect(getReimbursementAmount('srv-g', 'srv-a', 'srv-b')).toBeNull()
  })
})
