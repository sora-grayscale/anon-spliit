import { webcrypto } from 'crypto'
import { TextEncoder, TextDecoder } from 'util'

// Polyfill Web Crypto API for Node.js test environment
Object.defineProperty(globalThis, 'crypto', {
  value: webcrypto,
})

// Polyfill TextEncoder/TextDecoder for jsdom
Object.defineProperty(globalThis, 'TextEncoder', {
  value: TextEncoder,
})
Object.defineProperty(globalThis, 'TextDecoder', {
  value: TextDecoder,
})

// React 19: opt into the "act" testing environment so state updates from
// hooks under @testing-library/react are flushed synchronously and `act`
// warnings are silenced. Required by Issue #170 hook tests.
;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
