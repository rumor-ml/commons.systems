import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * Firestore module tests
 *
 * CRITICAL REGRESSION TEST: Module must be importable without Firebase env vars
 * This prevents breaking local development when .env file is missing
 */

describe('Firestore module', () => {
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
    it('validateTransaction returns null for invalid data', async () => {
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

    it('returns null for invalid transaction data', async () => {
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
});
