import { describe, it, expect, beforeEach, afterEach } from 'vitest';

/**
 * Unit tests for collection name logic
 * Tests the getCollectionNameFromConfig function behavior
 */

// Mock import.meta.env
const originalEnv = { ...import.meta.env };

function setEnv(key: string, value: string | undefined) {
  if (value === undefined) {
    delete (import.meta.env as any)[key];
  } else {
    (import.meta.env as any)[key] = value;
  }
}

function resetEnv() {
  Object.keys(import.meta.env).forEach((key) => {
    delete (import.meta.env as any)[key];
  });
  Object.assign(import.meta.env, originalEnv);
}

describe('Collection Names', () => {
  beforeEach(() => {
    // Reset environment before each test
    resetEnv();
  });

  afterEach(() => {
    resetEnv();
  });

  describe('getTransactionsCollectionName', () => {
    it('should return worker-0 suffix in emulator mode', async () => {
      setEnv('VITE_USE_FIREBASE_EMULATOR', 'true');

      // Re-import to get fresh module with new env
      const { getTransactionsCollectionName } = await import('./collection-names.js');
      const collectionName = getTransactionsCollectionName();

      expect(collectionName).toBe('budget-demo-transactions-worker-0');
    });

    it('should return base collection name in production mode', async () => {
      setEnv('VITE_USE_FIREBASE_EMULATOR', 'false');
      setEnv('VITE_PR_NUMBER', undefined);
      setEnv('VITE_BRANCH_NAME', undefined);

      const { getTransactionsCollectionName } = await import('./collection-names.js');
      const collectionName = getTransactionsCollectionName();

      expect(collectionName).toBe('budget-demo-transactions');
    });

    it('should return PR-specific collection name when PR_NUMBER is set', async () => {
      setEnv('VITE_USE_FIREBASE_EMULATOR', 'false');
      setEnv('VITE_PR_NUMBER', '123');

      const { getTransactionsCollectionName } = await import('./collection-names.js');
      const collectionName = getTransactionsCollectionName();

      expect(collectionName).toBe('budget-demo-transactions_pr_123');
    });

    it('should return branch-specific collection name when BRANCH_NAME is set', async () => {
      setEnv('VITE_USE_FIREBASE_EMULATOR', 'false');
      setEnv('VITE_PR_NUMBER', undefined);
      setEnv('VITE_BRANCH_NAME', 'feature-branch');

      const { getTransactionsCollectionName } = await import('./collection-names.js');
      const collectionName = getTransactionsCollectionName();

      expect(collectionName).toBe('budget-demo-transactions_preview_feature-branch');
    });

    it('should return base collection name when BRANCH_NAME is main', async () => {
      setEnv('VITE_USE_FIREBASE_EMULATOR', 'false');
      setEnv('VITE_PR_NUMBER', undefined);
      setEnv('VITE_BRANCH_NAME', 'main');

      const { getTransactionsCollectionName } = await import('./collection-names.js');
      const collectionName = getTransactionsCollectionName();

      expect(collectionName).toBe('budget-demo-transactions');
    });

    it('should prioritize emulator mode over branch/PR settings', async () => {
      setEnv('VITE_USE_FIREBASE_EMULATOR', 'true');
      setEnv('VITE_PR_NUMBER', '123');
      setEnv('VITE_BRANCH_NAME', 'feature-branch');

      const { getTransactionsCollectionName } = await import('./collection-names.js');
      const collectionName = getTransactionsCollectionName();

      expect(collectionName).toBe('budget-demo-transactions-worker-0');
    });

    it('should sanitize branch names with special characters', async () => {
      setEnv('VITE_USE_FIREBASE_EMULATOR', 'false');
      setEnv('VITE_PR_NUMBER', undefined);
      setEnv('VITE_BRANCH_NAME', 'feature/my-branch_test');

      const { getTransactionsCollectionName } = await import('./collection-names.js');
      const collectionName = getTransactionsCollectionName();

      expect(collectionName).toBe('budget-demo-transactions_preview_feature-my-branch-test');
    });

    it('should truncate branch names longer than 50 characters', async () => {
      setEnv('VITE_USE_FIREBASE_EMULATOR', 'false');
      setEnv('VITE_PR_NUMBER', undefined);
      setEnv('VITE_BRANCH_NAME', 'a'.repeat(60));

      const { getTransactionsCollectionName } = await import('./collection-names.js');
      const collectionName = getTransactionsCollectionName();

      const expectedSuffix = 'a'.repeat(50);
      expect(collectionName).toBe(`budget-demo-transactions_preview_${expectedSuffix}`);
      expect(collectionName.length).toBeLessThanOrEqual(100);
    });
  });

  describe('Other collection getters', () => {
    it('should apply same logic to statements collection', async () => {
      setEnv('VITE_USE_FIREBASE_EMULATOR', 'true');

      const { getStatementsCollectionName } = await import('./collection-names.js');
      const collectionName = getStatementsCollectionName();

      expect(collectionName).toBe('budget-demo-statements-worker-0');
    });

    it('should apply same logic to accounts collection', async () => {
      setEnv('VITE_USE_FIREBASE_EMULATOR', 'true');

      const { getAccountsCollectionName } = await import('./collection-names.js');
      const collectionName = getAccountsCollectionName();

      expect(collectionName).toBe('budget-demo-accounts-worker-0');
    });

    it('should apply same logic to institutions collection', async () => {
      setEnv('VITE_USE_FIREBASE_EMULATOR', 'true');

      const { getInstitutionsCollectionName } = await import('./collection-names.js');
      const collectionName = getInstitutionsCollectionName();

      expect(collectionName).toBe('budget-demo-institutions-worker-0');
    });
  });
});
