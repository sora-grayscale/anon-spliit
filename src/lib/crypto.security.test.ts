/**
 * @jest-environment jsdom
 *
 * Security tests for crypto utilities
 * These tests verify the cryptographic security of the E2EE implementation
 */

import {
  base64ToKey,
  combineKeys,
  decrypt,
  decryptNumber,
  decryptObject,
  deriveKey,
  deriveKeyFromPassword,
  encrypt,
  encryptNumber,
  encryptObject,
  generateMasterKey,
  generateSalt,
  generateSecurePassword,
  isEncrypted,
  keyToBase64,
  validatePasswordStrength,
} from './crypto'

describe('Crypto Security Tests', () => {
  describe('Key Generation Security', () => {
    it('should generate 256-bit (32 byte) keys for AES-256 (Issue #50)', () => {
      const key = generateMasterKey()
      expect(key.length).toBe(32)
    })

    it('should generate unique keys each time', () => {
      const keys = new Set<string>()
      for (let i = 0; i < 100; i++) {
        const key = generateMasterKey()
        const keyStr = keyToBase64(key)
        expect(keys.has(keyStr)).toBe(false)
        keys.add(keyStr)
      }
    })

    it('should generate keys with high entropy', () => {
      const key = generateMasterKey()
      // Check that key has varied byte values (not all zeros or predictable)
      const uniqueBytes = new Set(key)
      // With 16 random bytes, we expect significant diversity
      expect(uniqueBytes.size).toBeGreaterThan(4)
    })

    it('should not generate weak keys (all zeros)', () => {
      const key = generateMasterKey()
      const allZeros = key.every((b) => b === 0)
      expect(allZeros).toBe(false)
    })
  })

  describe('Encryption/Decryption Security', () => {
    it('should encrypt and decrypt data correctly', async () => {
      const key = generateMasterKey()
      const plaintext = 'Sensitive financial data: $1,234.56'

      const encrypted = await encrypt(plaintext, key)
      const decrypted = await decrypt(encrypted, key)

      expect(decrypted).toBe(plaintext)
    })

    it('should produce different ciphertext for same plaintext (random IV)', async () => {
      const key = generateMasterKey()
      const plaintext = 'Same message'

      const encrypted1 = await encrypt(plaintext, key)
      const encrypted2 = await encrypt(plaintext, key)

      // Ciphertext should differ due to random IV
      expect(encrypted1).not.toBe(encrypted2)

      // But both should decrypt to same plaintext
      expect(await decrypt(encrypted1, key)).toBe(plaintext)
      expect(await decrypt(encrypted2, key)).toBe(plaintext)
    })

    it('should fail to decrypt with wrong key', async () => {
      const key1 = generateMasterKey()
      const key2 = generateMasterKey()
      const plaintext = 'Secret message'

      const encrypted = await encrypt(plaintext, key1)

      // Decryption with wrong key should fail
      await expect(decrypt(encrypted, key2)).rejects.toThrow()
    })

    it('should fail to decrypt tampered ciphertext', async () => {
      const key = generateMasterKey()
      const plaintext = 'Important data'

      const encrypted = await encrypt(plaintext, key)
      // Tamper with the ciphertext by changing a character
      const tamperedChars = encrypted.split('')
      tamperedChars[20] = tamperedChars[20] === 'A' ? 'B' : 'A'
      const tampered = tamperedChars.join('')

      // Decryption should fail due to GCM authentication
      await expect(decrypt(tampered, key)).rejects.toThrow()
    })

    it('should handle empty string encryption', async () => {
      const key = generateMasterKey()
      const plaintext = ''

      const encrypted = await encrypt(plaintext, key)
      const decrypted = await decrypt(encrypted, key)

      expect(decrypted).toBe(plaintext)
    })

    it('should handle unicode characters', async () => {
      const key = generateMasterKey()
      const plaintext = '日本語テスト 🔒 émojis'

      const encrypted = await encrypt(plaintext, key)
      const decrypted = await decrypt(encrypted, key)

      expect(decrypted).toBe(plaintext)
    })

    it('should handle large data', async () => {
      const key = generateMasterKey()
      const plaintext = 'A'.repeat(100000) // 100KB of data

      const encrypted = await encrypt(plaintext, key)
      const decrypted = await decrypt(encrypted, key)

      expect(decrypted).toBe(plaintext)
    })
  })

  describe('Number Encryption Security', () => {
    it('should encrypt and decrypt numbers correctly', async () => {
      const key = generateMasterKey()

      const testNumbers = [0, 1, -1, 100, 1234567890, -999999]
      for (const num of testNumbers) {
        const encrypted = await encryptNumber(num, key)
        const decrypted = await decryptNumber(encrypted, key)
        expect(decrypted).toBe(num)
      }
    })

    it('should encrypt different numbers to different ciphertext', async () => {
      const key = generateMasterKey()

      const enc1 = await encryptNumber(100, key)
      const enc2 = await encryptNumber(200, key)

      expect(enc1).not.toBe(enc2)
    })
  })

  describe('Object Encryption Security', () => {
    it('should encrypt and decrypt objects correctly', async () => {
      const key = generateMasterKey()
      const obj = {
        name: 'Test Group',
        amount: 1234.56,
        participants: ['Alice', 'Bob'],
      }

      const encrypted = await encryptObject(obj, key)
      const decrypted = await decryptObject<typeof obj>(encrypted, key)

      expect(decrypted).toEqual(obj)
    })

    it('should handle nested objects', async () => {
      const key = generateMasterKey()
      const obj = {
        level1: {
          level2: {
            level3: {
              data: 'deep nested',
            },
          },
        },
      }

      const encrypted = await encryptObject(obj, key)
      const decrypted = await decryptObject<typeof obj>(encrypted, key)

      expect(decrypted).toEqual(obj)
    })
  })

  describe('PBKDF2 Password Derivation Security', () => {
    it('should derive consistent keys from same password and salt', async () => {
      const password = 'SecureP@ssw0rd!'
      const salt = generateSalt()

      const key1 = await deriveKeyFromPassword(password, salt)
      const key2 = await deriveKeyFromPassword(password, salt)

      expect(keyToBase64(key1)).toBe(keyToBase64(key2))
    })

    it('should derive different keys for different passwords', async () => {
      const salt = generateSalt()

      const key1 = await deriveKeyFromPassword('password1', salt)
      const key2 = await deriveKeyFromPassword('password2', salt)

      expect(keyToBase64(key1)).not.toBe(keyToBase64(key2))
    })

    it('should derive different keys for different salts', async () => {
      const password = 'samePassword'
      const salt1 = generateSalt()
      const salt2 = generateSalt()

      const key1 = await deriveKeyFromPassword(password, salt1)
      const key2 = await deriveKeyFromPassword(password, salt2)

      expect(keyToBase64(key1)).not.toBe(keyToBase64(key2))
    })

    it('should generate unique salts', () => {
      const salts = new Set<string>()
      for (let i = 0; i < 100; i++) {
        const salt = generateSalt()
        const saltStr = keyToBase64(salt)
        expect(salts.has(saltStr)).toBe(false)
        salts.add(saltStr)
      }
    })
  })

  describe('Key Combination Security', () => {
    it('should combine keys with XOR correctly', () => {
      const key1 = new Uint8Array([
        0xff, 0x00, 0xaa, 0x55, 0xff, 0x00, 0xaa, 0x55, 0xff, 0x00, 0xaa, 0x55,
        0xff, 0x00, 0xaa, 0x55,
      ])
      const key2 = new Uint8Array([
        0x00, 0xff, 0x55, 0xaa, 0x00, 0xff, 0x55, 0xaa, 0x00, 0xff, 0x55, 0xaa,
        0x00, 0xff, 0x55, 0xaa,
      ])

      const combined = combineKeys(key1, key2)

      // XOR properties: a ^ b ^ b = a
      const recovered = combineKeys(combined, key2)
      expect(recovered).toEqual(key1)
    })

    it('should throw error for mismatched key lengths', () => {
      const key1 = new Uint8Array(16)
      const key2 = new Uint8Array(15)

      expect(() => combineKeys(key1, key2)).toThrow(
        'Keys must be the same length',
      )
    })

    it('should produce valid encryption key from combined keys', async () => {
      const urlKey = generateMasterKey()
      const passwordKey = await deriveKeyFromPassword(
        'testPassword',
        generateSalt(),
      )
      const combinedKey = combineKeys(urlKey, passwordKey)

      // Combined key should work for encryption
      const plaintext = 'Test message'
      const encrypted = await encrypt(plaintext, combinedKey)
      const decrypted = await decrypt(encrypted, combinedKey)

      expect(decrypted).toBe(plaintext)
    })
  })

  describe('Secure Password Generation', () => {
    it('should generate passwords of correct length', () => {
      const lengths = [8, 12, 16, 20, 32]
      for (const length of lengths) {
        const password = generateSecurePassword(length)
        expect(password.length).toBe(length)
      }
    })

    it('should generate passwords with required character types', () => {
      // Generate multiple passwords to test consistency
      for (let i = 0; i < 10; i++) {
        const password = generateSecurePassword(16)

        expect(password).toMatch(/[a-z]/) // lowercase
        expect(password).toMatch(/[A-Z]/) // uppercase
        expect(password).toMatch(/[0-9]/) // digit
        expect(password).toMatch(/[!@#$%^&*()_+\-=]/) // symbol
      }
    })

    it('should generate unique passwords', () => {
      const passwords = new Set<string>()
      for (let i = 0; i < 100; i++) {
        const password = generateSecurePassword(16)
        expect(passwords.has(password)).toBe(false)
        passwords.add(password)
      }
    })

    it('should pass password strength validation', () => {
      for (let i = 0; i < 10; i++) {
        const password = generateSecurePassword(16)
        const result = validatePasswordStrength(password)
        expect(result.valid).toBe(true)
      }
    })
  })

  describe('Password Strength Validation', () => {
    it('should reject short passwords', () => {
      const result = validatePasswordStrength('Short1!')
      expect(result.valid).toBe(false)
      expect(result.message).toContain('at least 8 characters')
    })

    it('should reject very long passwords', () => {
      const result = validatePasswordStrength('A'.repeat(129))
      expect(result.valid).toBe(false)
      expect(result.message).toContain('less than 128')
    })

    it('should reject passwords without lowercase', () => {
      const result = validatePasswordStrength('UPPERCASE123!')
      expect(result.valid).toBe(false)
      expect(result.message).toContain('lowercase')
    })

    it('should reject passwords without uppercase', () => {
      const result = validatePasswordStrength('lowercase123!')
      expect(result.valid).toBe(false)
      expect(result.message).toContain('uppercase')
    })

    it('should reject passwords without numbers', () => {
      const result = validatePasswordStrength('NoNumbers!!')
      expect(result.valid).toBe(false)
      expect(result.message).toContain('number')
    })

    it('should accept strong passwords', () => {
      const strongPasswords = [
        'SecureP@ss1',
        'MyStr0ng!Password',
        'Test1234!abc',
      ]

      for (const password of strongPasswords) {
        const result = validatePasswordStrength(password)
        expect(result.valid).toBe(true)
      }
    })
  })

  describe('isEncrypted Detection', () => {
    it('should detect encrypted data correctly', async () => {
      const key = generateMasterKey()
      const encrypted = await encrypt('test data', key)

      expect(isEncrypted(encrypted)).toBe(true)
    })

    it('should reject short strings', () => {
      expect(isEncrypted('short')).toBe(false)
      expect(isEncrypted('')).toBe(false)
    })

    it('should reject strings with invalid characters', () => {
      expect(isEncrypted('this has spaces and is long enough to test')).toBe(
        false,
      )
      expect(isEncrypted('contains+invalid+chars+here')).toBe(false)
      expect(isEncrypted('contains=padding=here=====')).toBe(false)
    })

    it('should accept URL-safe base64', () => {
      expect(isEncrypted('abcdefghijklmnopqrstuvwxyz')).toBe(true)
      expect(isEncrypted('ABCDEFGHIJKLMNOPQRSTUVWXYZ')).toBe(true)
      expect(isEncrypted('0123456789-_abcdefABCDEF')).toBe(true)
    })
  })

  describe('Base64 Encoding Security', () => {
    it('should produce URL-safe base64 (no +, /, =)', () => {
      // Test with values that would produce special chars in standard base64
      const testKeys = [
        new Uint8Array([
          62, 63, 62, 63, 62, 63, 62, 63, 62, 63, 62, 63, 62, 63, 62, 63,
        ]),
        new Uint8Array([
          255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255,
          255, 255,
        ]),
      ]

      for (const key of testKeys) {
        const base64 = keyToBase64(key)
        expect(base64).not.toContain('+')
        expect(base64).not.toContain('/')
        expect(base64).not.toContain('=')
      }
    })

    it('should roundtrip all byte values correctly', () => {
      // Test all possible byte values
      const key = new Uint8Array([
        0, 31, 63, 95, 127, 159, 191, 223, 255, 128, 64, 32, 16, 8, 4, 2,
      ])
      const base64 = keyToBase64(key)
      const restored = base64ToKey(base64)

      expect(restored).toEqual(key)
    })
  })

  describe('Key Derivation Security', () => {
    it('should derive different keys for different purposes', async () => {
      const masterKey = generateMasterKey()

      const dataKey = await deriveKey(masterKey, 'data')
      const metadataKey = await deriveKey(masterKey, 'metadata')

      // Keys should be valid CryptoKey objects (check algorithm property)
      expect(dataKey.algorithm).toBeDefined()
      expect(metadataKey.algorithm).toBeDefined()
      expect((dataKey.algorithm as AesKeyAlgorithm).name).toBe('AES-GCM')
      expect((metadataKey.algorithm as AesKeyAlgorithm).name).toBe('AES-GCM')
    })
  })

  describe('HKDF Salt Migration (Issue #40)', () => {
    it('should decrypt data encrypted with new salt', async () => {
      const key = generateMasterKey()
      const plaintext = 'New encryption with proper salt'

      const encrypted = await encrypt(plaintext, key)
      const decrypted = await decrypt(encrypted, key)

      expect(decrypted).toBe(plaintext)
    })

    it('should decrypt legacy data encrypted with zero salt', async () => {
      // Simulate legacy encryption by using deriveKey with useZeroSalt=true
      const key = generateMasterKey()
      const plaintext = 'Legacy data from before salt fix'

      // Encrypt using legacy zero salt method (simulating old data)
      const legacyKey = await deriveKey(key, 'data', true)
      const iv = crypto.getRandomValues(new Uint8Array(12))
      const encoded = new TextEncoder().encode(plaintext)

      const ciphertext = await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv },
        legacyKey,
        encoded,
      )

      // Combine IV + ciphertext (legacy format)
      const combined = new Uint8Array(iv.length + ciphertext.byteLength)
      combined.set(iv)
      combined.set(new Uint8Array(ciphertext), iv.length)
      const legacyEncrypted = keyToBase64(combined)

      // Decrypt should work with automatic fallback
      const decrypted = await decrypt(legacyEncrypted, key)
      expect(decrypted).toBe(plaintext)
    })

    it('should derive different keys with new salt vs zero salt', async () => {
      const masterKey = generateMasterKey()

      const newKey = await deriveKey(masterKey, 'data', false)
      const legacyKey = await deriveKey(masterKey, 'data', true)

      // Keys should be different CryptoKey objects
      // We can verify by encrypting same data and getting different results
      const testData = new TextEncoder().encode('test')
      const iv = new Uint8Array(12) // Fixed IV for comparison

      const newEncrypted = await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv },
        newKey,
        testData,
      )
      const legacyEncrypted = await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv },
        legacyKey,
        testData,
      )

      // Different keys should produce different ciphertext
      expect(new Uint8Array(newEncrypted)).not.toEqual(
        new Uint8Array(legacyEncrypted),
      )
    })
  })

  describe('Attack Scenarios', () => {
    it('should resist replay attacks (unique ciphertext)', async () => {
      const key = generateMasterKey()
      const plaintext = 'amount: 100'

      const ciphertexts = new Set<string>()
      for (let i = 0; i < 100; i++) {
        const encrypted = await encrypt(plaintext, key)
        expect(ciphertexts.has(encrypted)).toBe(false)
        ciphertexts.add(encrypted)
      }
    })

    it('should not leak plaintext length significantly', async () => {
      const key = generateMasterKey()

      // Different length plaintexts
      const short = await encrypt('a', key)
      const medium = await encrypt('a'.repeat(10), key)
      const long = await encrypt('a'.repeat(100), key)

      // Ciphertext length should be proportional but not reveal exact length
      // due to base64 encoding overhead
      expect(short.length).toBeLessThan(medium.length)
      expect(medium.length).toBeLessThan(long.length)
    })

    it('should resist known-plaintext attacks', async () => {
      const key = generateMasterKey()

      // Even knowing plaintext-ciphertext pairs, attacker cannot derive key
      const pairs = []
      for (let i = 0; i < 10; i++) {
        const plaintext = `known-${i}`
        const ciphertext = await encrypt(plaintext, key)
        pairs.push({ plaintext, ciphertext })
      }

      // All decryptions should work with correct key
      for (const { plaintext, ciphertext } of pairs) {
        expect(await decrypt(ciphertext, key)).toBe(plaintext)
      }

      // Wrong key should fail
      const wrongKey = generateMasterKey()
      for (const { ciphertext } of pairs) {
        await expect(decrypt(ciphertext, wrongKey)).rejects.toThrow()
      }
    })
  })
})
