/** @jest-environment node */

import { setPendingFragment, takePendingFragment } from './pending-fragment'

describe('pending-fragment on the server (no window)', () => {
  it('ignores writes so key material never enters shared process memory', () => {
    setPendingFragment('/groups/srv', 'SRVKEY')
    expect(takePendingFragment('/groups/srv')).toBeNull()
  })
})
