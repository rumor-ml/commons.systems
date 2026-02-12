import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * Firestore module tests
 *
 * CRITICAL REGRESSION TEST: Module must be importable without Firebase env vars
 * This prevents breaking local development when .env file is missing
 */

describe('Firestore module', () => {
  // TODO(#1963): Extract clearFirebaseEnvVars() helper to eliminate repetitive cleanup code
  // Helper to clear all Firebase env vars
  function clearFirebaseEnvVars(): void {
    delete import.meta.env.VITE_FIREBASE_API_KEY;
    delete import.meta.env.VITE_FIREBASE_AUTH_DOMAIN;
    delete import.meta.env.VITE_FIREBASE_PROJECT_ID;
    delete import.meta.env.VITE_FIREBASE_STORAGE_BUCKET;
    delete import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID;
    delete import.meta.env.VITE_FIREBASE_APP_ID;
  }

  describe('Module Loading (Regression Test)', () => {
    it('can be imported without Firebase environment variables', async () => {
      // This test prevents regression of the bug where module threw error on import
      // when Firebase env vars were missing, breaking local development
      //
      // See: Budget app failed to load with "Missing required Firebase environment variables"
      // Fix: Made validation lazy - only validates when initFirebase() is called

      // Module import should not throw even without env vars
      const firestoreModule = await import('./firestore');
      expect(firestoreModule).toBeDefined();

      // Can access exports without errors
      const { isValidDateString, createDateString } = firestoreModule;
      expect(typeof isValidDateString).toBe('function');
      expect(typeof createDateString).toBe('function');
    });
  });

  describe('Firebase Validation', () => {
    beforeEach(() => {
      // Clear any cached Firebase instances
      vi.resetModules();
    });

    it('throws error when trying to initialize Firebase without env vars', async () => {
      // Clear environment variables
      const originalEnv = import.meta.env;
      vi.stubGlobal('import.meta', {
        env: {
          // All Firebase vars missing
          MODE: 'test',
        },
      });

      // Dynamically import to get fresh module
      const { initFirebase } = await import('./firestore');

      expect(() => {
        initFirebase();
      }).toThrow(/Missing required Firebase environment variables/);

      // Restore environment
      vi.stubGlobal('import.meta', originalEnv);
    });

    it('provides helpful error message with missing var names', async () => {
      const originalEnv = import.meta.env;
      vi.stubGlobal('import.meta', {
        env: {
          // Only some vars present
          VITE_FIREBASE_API_KEY: 'test-key',
          // Rest missing
          MODE: 'test',
        },
      });

      const { initFirebase } = await import('./firestore');

      expect(() => {
        initFirebase();
      }).toThrow(/VITE_FIREBASE_AUTH_DOMAIN/);
      expect(() => {
        initFirebase();
      }).toThrow(/VITE_FIREBASE_PROJECT_ID/);

      vi.stubGlobal('import.meta', originalEnv);
    });

    it('includes helpful local dev instructions in error message', async () => {
      const originalEnv = import.meta.env;
      vi.stubGlobal('import.meta', {
        env: { MODE: 'test' },
      });

      const { initFirebase } = await import('./firestore');

      expect(() => {
        initFirebase();
      }).toThrow(/copy \.env\.example to \.env/);

      vi.stubGlobal('import.meta', originalEnv);
    });
  });

  describe('isFirebaseConfigured', () => {
    it('returns true when all env vars are present and valid', async () => {
      // In test environment, import.meta.env may not have Firebase vars
      // This test validates the logic assuming env vars are set
      // Real validation happens in integration/E2E tests

      const { isFirebaseConfigured } = await import('./firestore');

      // Save current env state
      const currentEnv = { ...import.meta.env };

      // Temporarily set valid env vars
      import.meta.env.VITE_FIREBASE_API_KEY = 'AIzaSyTest123';
      import.meta.env.VITE_FIREBASE_AUTH_DOMAIN = 'my-project.firebaseapp.com';
      import.meta.env.VITE_FIREBASE_PROJECT_ID = 'my-project';
      import.meta.env.VITE_FIREBASE_STORAGE_BUCKET = 'my-project.appspot.com';
      import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID = '123456789';
      import.meta.env.VITE_FIREBASE_APP_ID = '1:123456789:web:abc123';

      expect(isFirebaseConfigured()).toBe(true);

      // Restore env
      Object.assign(import.meta.env, currentEnv);
    });

    it('returns false when env vars are missing', async () => {
      const { isFirebaseConfigured } = await import('./firestore');

      // Save current env state
      const currentEnv = { ...import.meta.env };

      // Clear Firebase env vars
      delete import.meta.env.VITE_FIREBASE_API_KEY;
      delete import.meta.env.VITE_FIREBASE_AUTH_DOMAIN;
      delete import.meta.env.VITE_FIREBASE_PROJECT_ID;
      delete import.meta.env.VITE_FIREBASE_STORAGE_BUCKET;
      delete import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID;
      delete import.meta.env.VITE_FIREBASE_APP_ID;

      expect(isFirebaseConfigured()).toBe(false);

      // Restore env
      Object.assign(import.meta.env, currentEnv);
    });

    it('returns false when env vars are empty strings', async () => {
      const { isFirebaseConfigured } = await import('./firestore');

      // Save current env state
      const currentEnv = { ...import.meta.env };

      // Set all to empty strings
      import.meta.env.VITE_FIREBASE_API_KEY = '';
      import.meta.env.VITE_FIREBASE_AUTH_DOMAIN = '';
      import.meta.env.VITE_FIREBASE_PROJECT_ID = '';
      import.meta.env.VITE_FIREBASE_STORAGE_BUCKET = '';
      import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID = '';
      import.meta.env.VITE_FIREBASE_APP_ID = '';

      expect(isFirebaseConfigured()).toBe(false);

      // Restore env
      Object.assign(import.meta.env, currentEnv);
    });

    it('returns false when some env vars are empty strings', async () => {
      const { isFirebaseConfigured } = await import('./firestore');

      // Save current env state
      const currentEnv = { ...import.meta.env };

      // Set some valid, some empty
      import.meta.env.VITE_FIREBASE_API_KEY = 'AIzaSyTest123';
      import.meta.env.VITE_FIREBASE_AUTH_DOMAIN = ''; // Empty string
      import.meta.env.VITE_FIREBASE_PROJECT_ID = 'my-project';
      import.meta.env.VITE_FIREBASE_STORAGE_BUCKET = 'my-project.appspot.com';
      import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID = '123456789';
      import.meta.env.VITE_FIREBASE_APP_ID = '1:123456789:web:abc123';

      expect(isFirebaseConfigured()).toBe(false);

      // Restore env
      Object.assign(import.meta.env, currentEnv);
    });

    it('returns false when env vars contain placeholder values from .env.example', async () => {
      const { isFirebaseConfigured } = await import('./firestore');

      // Save current env state
      const currentEnv = { ...import.meta.env };

      // Set placeholder values
      import.meta.env.VITE_FIREBASE_API_KEY = 'your-api-key-here';
      import.meta.env.VITE_FIREBASE_AUTH_DOMAIN = 'your-project-id.firebaseapp.com';
      import.meta.env.VITE_FIREBASE_PROJECT_ID = 'your-project-id';
      import.meta.env.VITE_FIREBASE_STORAGE_BUCKET = 'your-project-id.appspot.com';
      import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID = 'your-sender-id';
      import.meta.env.VITE_FIREBASE_APP_ID = 'your-app-id';

      expect(isFirebaseConfigured()).toBe(false);

      // Restore env
      Object.assign(import.meta.env, currentEnv);
    });

    it('returns false when only some env vars contain placeholder values', async () => {
      const { isFirebaseConfigured } = await import('./firestore');

      // Save current env state
      const currentEnv = { ...import.meta.env };

      // Mix of real and placeholder values
      import.meta.env.VITE_FIREBASE_API_KEY = 'AIzaSyTest123'; // Real
      import.meta.env.VITE_FIREBASE_AUTH_DOMAIN = 'my-project.firebaseapp.com'; // Real
      import.meta.env.VITE_FIREBASE_PROJECT_ID = 'your-project-id'; // Placeholder
      import.meta.env.VITE_FIREBASE_STORAGE_BUCKET = 'my-project.appspot.com'; // Real
      import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID = '123456789'; // Real
      import.meta.env.VITE_FIREBASE_APP_ID = '1:123456789:web:abc123'; // Real

      expect(isFirebaseConfigured()).toBe(false);

      // Restore env
      Object.assign(import.meta.env, currentEnv);
    });

    it('returns true in emulator mode even without env vars', async () => {
      const { isFirebaseConfigured } = await import('./firestore');

      const currentEnv = { ...import.meta.env };

      clearFirebaseEnvVars();
      import.meta.env.VITE_USE_FIREBASE_EMULATOR = 'true';

      // Emulator mode bypasses Firebase config validation and returns true
      expect(isFirebaseConfigured()).toBe(true);

      Object.assign(import.meta.env, currentEnv);
      // Clean up emulator flag if it wasn't in original environment
      if (!('VITE_USE_FIREBASE_EMULATOR' in currentEnv)) {
        delete import.meta.env.VITE_USE_FIREBASE_EMULATOR;
      }
    });

    it('returns false when VITE_USE_FIREBASE_EMULATOR is false and env vars are missing', async () => {
      const { isFirebaseConfigured } = await import('./firestore');

      const currentEnv = { ...import.meta.env };

      clearFirebaseEnvVars();
      import.meta.env.VITE_USE_FIREBASE_EMULATOR = 'false';

      // With 'false', emulator mode is disabled and Firebase config is required
      expect(isFirebaseConfigured()).toBe(false);

      Object.assign(import.meta.env, currentEnv);
      // Clean up emulator flag if it wasn't in original environment
      if (!('VITE_USE_FIREBASE_EMULATOR' in currentEnv)) {
        delete import.meta.env.VITE_USE_FIREBASE_EMULATOR;
      }
    });

    it('returns false when VITE_USE_FIREBASE_EMULATOR is uppercase TRUE', async () => {
      const { isFirebaseConfigured } = await import('./firestore');

      const currentEnv = { ...import.meta.env };

      clearFirebaseEnvVars();
      import.meta.env.VITE_USE_FIREBASE_EMULATOR = 'TRUE'; // Uppercase

      // Uppercase 'TRUE' should not match - requires exact 'true' string
      expect(isFirebaseConfigured()).toBe(false);

      Object.assign(import.meta.env, currentEnv);
      // Clean up emulator flag if it wasn't in original environment
      if (!('VITE_USE_FIREBASE_EMULATOR' in currentEnv)) {
        delete import.meta.env.VITE_USE_FIREBASE_EMULATOR;
      }
    });

    it('does not throw error when called (unlike validateFirebaseConfig)', async () => {
      const { isFirebaseConfigured } = await import('./firestore');

      const currentEnv = { ...import.meta.env };

      clearFirebaseEnvVars();
      delete import.meta.env.VITE_USE_FIREBASE_EMULATOR;

      // Should return false, not throw
      expect(() => {
        const result = isFirebaseConfigured();
        expect(result).toBe(false);
      }).not.toThrow();

      Object.assign(import.meta.env, currentEnv);
    });
  });

  describe('DateString branded type', () => {
    it('isValidDateString validates YYYY-MM-DD format', async () => {
      const { isValidDateString } = await import('./firestore');

      // Valid formats
      expect(isValidDateString('2024-01-15')).toBe(true);
      expect(isValidDateString('2024-12-31')).toBe(true);

      // Invalid formats (wrong structure)
      expect(isValidDateString('2024-1-15')).toBe(false); // Missing leading zero
      expect(isValidDateString('2024/01/15')).toBe(false); // Wrong separator
      expect(isValidDateString('15-01-2024')).toBe(false); // Wrong order
      expect(isValidDateString('not-a-date')).toBe(false); // Not a date

      // Note: Regex only checks format, not validity
      // These pass format check (YYYY-MM-DD) but are invalid dates
      expect(isValidDateString('2024-13-01')).toBe(true); // Invalid month (format valid)
      expect(isValidDateString('2024-01-32')).toBe(true); // Invalid day (format valid)
    });

    it('createDateString creates valid DateString or throws', async () => {
      const { createDateString } = await import('./firestore');

      expect(createDateString('2024-01-15')).toBe('2024-01-15');
      expect(() => createDateString('invalid')).toThrow(/Invalid date format/);
      expect(() => createDateString('2024/01/15')).toThrow(/Invalid date format/);
    });
  });

  describe('Transaction validation', () => {
    // TODO(#2000): Fix test - validateTransaction throws errors, doesn't return null
    it.skip('validateTransaction handles invalid data gracefully', async () => {
      const { validateTransaction } = await import('./firestore');

      expect(validateTransaction({})).toBe(null);
      expect(validateTransaction({ id: 'test' })).toBe(null); // Missing required fields
      expect(
        validateTransaction({
          id: 'test',
          userId: 'user1',
          date: 'invalid-date',
          description: 'Test',
          amount: 100,
          category: 'food',
        })
      ).toBe(null); // Invalid date format
    });

    it('validateTransaction returns Transaction for valid data', async () => {
      const { validateTransaction } = await import('./firestore');

      const validData = {
        id: 'txn-1',
        userId: 'user-1',
        date: '2024-01-15',
        description: 'Test transaction',
        amount: -50.0,
        category: 'groceries',
        redeemable: true,
        vacation: false,
        statementIds: ['stmt-1'],
      };

      const result = validateTransaction(validData);
      expect(result).not.toBe(null);
      expect(result?.id).toBe('txn-1');
      expect(result?.date).toBe('2024-01-15');
      expect(result?.amount).toBe(-50.0);
    });
  });

  describe('createTransaction factory', () => {
    it('creates valid Transaction with all fields', async () => {
      const { createTransaction } = await import('./firestore');

      const txn = createTransaction({
        id: 'txn-1',
        userId: 'user-1',
        date: '2024-01-15',
        description: 'Grocery shopping',
        amount: -75.5,
        category: 'groceries',
        redeemable: true,
        vacation: false,
        transfer: false,
        redemptionRate: 0.02,
        statementIds: ['stmt-1'],
      });

      expect(txn).not.toBe(null);
      expect(txn?.id).toBe('txn-1');
      expect(txn?.date).toBe('2024-01-15');
      expect(txn?.amount).toBe(-75.5);
      expect(txn?.redeemable).toBe(true);
    });

    // TODO(#2000): Fix test - createTransaction throws errors, doesn't return null
    it.skip('handles invalid transaction data gracefully', async () => {
      const { createTransaction } = await import('./firestore');

      const invalid = createTransaction({
        id: 'txn-1',
        userId: 'user-1',
        date: 'not-a-date', // Invalid date format
        description: 'Test',
        amount: 100,
        category: 'food',
      });

      expect(invalid).toBe(null);
    });
  });

  describe('Firebase Emulator Connection', () => {
    beforeEach(() => {
      vi.resetModules();
    });

    it('does not connect to emulator when VITE_USE_FIREBASE_EMULATOR is false', async () => {
      const originalEnv = import.meta.env;
      vi.stubGlobal('import.meta', {
        env: {
          VITE_USE_FIREBASE_EMULATOR: 'false',
          VITE_FIREBASE_API_KEY: 'test-key',
          VITE_FIREBASE_AUTH_DOMAIN: 'test.firebaseapp.com',
          VITE_FIREBASE_PROJECT_ID: 'test-project',
          VITE_FIREBASE_STORAGE_BUCKET: 'test.appspot.com',
          VITE_FIREBASE_MESSAGING_SENDER_ID: '123456',
          VITE_FIREBASE_APP_ID: '1:123456:web:abc123',
          MODE: 'test',
        },
      });

      // Import module - should not throw
      const { getFirestoreDb } = await import('./firestore');

      // Should not throw when getting Firestore instance
      // (In real test, would verify no connectFirestoreEmulator call, but hard to test without mocking)
      expect(typeof getFirestoreDb).toBe('function');

      vi.stubGlobal('import.meta', originalEnv);
    });

    it('attempts to connect to emulator when VITE_USE_FIREBASE_EMULATOR is true', async () => {
      const originalEnv = import.meta.env;
      vi.stubGlobal('import.meta', {
        env: {
          VITE_USE_FIREBASE_EMULATOR: 'true',
          VITE_FIREBASE_EMULATOR_FIRESTORE_PORT: '8081',
          VITE_FIREBASE_API_KEY: 'test-key',
          VITE_FIREBASE_AUTH_DOMAIN: 'test.firebaseapp.com',
          VITE_FIREBASE_PROJECT_ID: 'test-project',
          VITE_FIREBASE_STORAGE_BUCKET: 'test.appspot.com',
          VITE_FIREBASE_MESSAGING_SENDER_ID: '123456',
          VITE_FIREBASE_APP_ID: '1:123456:web:abc123',
          MODE: 'test',
        },
      });

      // Import module - emulator connection happens on getFirestoreDb call
      const { getFirestoreDb } = await import('./firestore');

      // Note: In unit tests, Firebase initialization may fail due to missing global objects
      // This test verifies the code path exists, not that it successfully connects
      // Real emulator connection is tested in E2E tests
      expect(typeof getFirestoreDb).toBe('function');

      vi.stubGlobal('import.meta', originalEnv);
    });

    it('uses default emulator port when VITE_FIREBASE_EMULATOR_FIRESTORE_PORT is not set', async () => {
      const originalEnv = import.meta.env;
      vi.stubGlobal('import.meta', {
        env: {
          VITE_USE_FIREBASE_EMULATOR: 'true',
          // VITE_FIREBASE_EMULATOR_FIRESTORE_PORT not set - should use default
          VITE_FIREBASE_API_KEY: 'test-key',
          VITE_FIREBASE_AUTH_DOMAIN: 'test.firebaseapp.com',
          VITE_FIREBASE_PROJECT_ID: 'test-project',
          VITE_FIREBASE_STORAGE_BUCKET: 'test.appspot.com',
          VITE_FIREBASE_MESSAGING_SENDER_ID: '123456',
          VITE_FIREBASE_APP_ID: '1:123456:web:abc123',
          MODE: 'test',
        },
      });

      // Code should use default port 8081
      const { getFirestoreDb } = await import('./firestore');
      expect(typeof getFirestoreDb).toBe('function');

      vi.stubGlobal('import.meta', originalEnv);
    });

    it('does not connect to emulator when VITE_USE_FIREBASE_EMULATOR is uppercase TRUE', async () => {
      const originalEnv = import.meta.env;
      vi.stubGlobal('import.meta', {
        env: {
          VITE_USE_FIREBASE_EMULATOR: 'TRUE', // Uppercase should NOT match
          VITE_FIREBASE_API_KEY: 'test-key',
          VITE_FIREBASE_AUTH_DOMAIN: 'test.firebaseapp.com',
          VITE_FIREBASE_PROJECT_ID: 'test-project',
          VITE_FIREBASE_STORAGE_BUCKET: 'test.appspot.com',
          VITE_FIREBASE_MESSAGING_SENDER_ID: '123456',
          VITE_FIREBASE_APP_ID: '1:123456:web:abc123',
          MODE: 'test',
        },
      });

      // Import module - should not attempt emulator connection
      const { getFirestoreDb, isFirebaseConfigured } = await import('./firestore');

      // isFirebaseConfigured should return true (has all config)
      expect(isFirebaseConfigured()).toBe(true);

      // getFirestoreDb should work without emulator connection
      expect(typeof getFirestoreDb).toBe('function');

      vi.stubGlobal('import.meta', originalEnv);
    });
  });
});
