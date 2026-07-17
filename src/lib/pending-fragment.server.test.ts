/** @jest-environment node */

import { setPendingFragment, takePendingFragment } from './pending-fragment'

const SUBJECT = { id: 'srv', isAdmin: false }

describe('pending-fragment on the server (no window)', () => {
  it('ignores writes so key material never enters shared process memory', () => {
    setPendingFragment('/groups/srv', 'SRVKEY', SUBJECT)
    expect(takePendingFragment('/groups/srv', SUBJECT)).toBeNull()
  })
})
