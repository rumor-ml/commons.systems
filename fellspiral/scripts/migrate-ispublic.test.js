#!/usr/bin/env node
/**
 * Integration tests for migrate-ispublic.js migration script
 *
 * Tests the exported functions directly with mocked Firestore dependencies,
 * verifying batch processing, error handling, idempotency, and dry-run behavior.
 */

import {
  BATCH_SIZE,
  identifyCardsNeedingMigration,
  splitIntoBatches,
  executeBatchMigration,
} from './migrate-ispublic.js';

// Test results tracking
let totalTests = 0;
let passedTests = 0;
let failedTests = 0;

function test(name, fn) {
  totalTests++;
  try {
    const result = fn();
    if (result instanceof Promise) {
      return result
        .then(() => {
          passedTests++;
          console.log(`  ✅ ${name}`);
        })
        .catch((error) => {
          failedTests++;
          console.error(`  ❌ ${name}`);
          console.error(`     ${error.message}`);
        });
    }
    passedTests++;
    console.log(`  ✅ ${name}`);
    return Promise.resolve();
  } catch (error) {
    failedTests++;
    console.error(`  ❌ ${name}`);
    console.error(`     ${error.message}`);
    return Promise.resolve();
  }
}

function assertEquals(actual, expected, message = '') {
  const actualStr = JSON.stringify(actual);
  const expectedStr = JSON.stringify(expected);
  if (actualStr !== expectedStr) {
    throw new Error(`${message}: expected ${expectedStr}, got ${actualStr}`);
  }
}

function assertTrue(condition, message = '') {
  if (!condition) {
    throw new Error(message || 'Expected condition to be true');
  }
}

// Mock factory for Firestore batch
function createMockBatch() {
  const updateCalls = [];
  return {
    update: (ref, data) => updateCalls.push({ ref, data }),
    commit: () => Promise.resolve(),
    _updateCalls: updateCalls,
  };
}

// Mock factory for Firestore db
function createMockDb(mockBatch) {
  return {
    batch: () => mockBatch,
  };
}

// Mock factory for cards collection reference
function createMockCardsRef() {
  return {
    doc: (id) => ({ id }),
  };
}

async function runTests() {
  console.log('\n🧪 Running migrate-ispublic.js integration tests...\n');

  // ============================================
  // BATCH_SIZE constant tests
  // ============================================
  console.log('BATCH_SIZE constant:');
  await test('should be 500 to match Firestore batch limit', () => {
    assertEquals(BATCH_SIZE, 500);
  });

  // ============================================
  // identifyCardsNeedingMigration tests
  // ============================================
  console.log('\nidentifyCardsNeedingMigration:');

  await test('should identify cards missing isPublic field', () => {
    const mockCards = [
      { id: 'card-1', data: () => ({ title: 'Card 1' }) },
      { id: 'card-2', data: () => ({ title: 'Card 2', isPublic: true }) },
      { id: 'card-3', data: () => ({ title: 'Card 3' }) },
      { id: 'card-4', data: () => ({ title: 'Card 4', isPublic: false }) },
    ];

    const result = identifyCardsNeedingMigration(mockCards);

    assertEquals(result.cardsNeedingUpdate.length, 2);
    assertEquals(
      result.cardsNeedingUpdate.map((c) => c.id),
      ['card-1', 'card-3']
    );
    assertEquals(result.cardsAlreadyHaveField.length, 2);
    assertEquals(
      result.cardsAlreadyHaveField.map((c) => c.id),
      ['card-2', 'card-4']
    );
  });

  await test('should handle empty collection', () => {
    const result = identifyCardsNeedingMigration([]);
    assertEquals(result.cardsNeedingUpdate.length, 0);
    assertEquals(result.cardsAlreadyHaveField.length, 0);
  });

  await test('should handle collection where all cards already migrated', () => {
    const mockCards = [
      { id: 'card-1', data: () => ({ title: 'Card 1', isPublic: true }) },
      { id: 'card-2', data: () => ({ title: 'Card 2', isPublic: false }) },
    ];

    const result = identifyCardsNeedingMigration(mockCards);
    assertEquals(result.cardsNeedingUpdate.length, 0);
    assertEquals(result.cardsAlreadyHaveField.length, 2);
  });

  await test('should handle cards with missing title or createdBy fields', () => {
    const mockCards = [
      { id: 'card-1', data: () => ({}) },
      { id: 'card-2', data: () => ({ title: 'Card 2' }) },
    ];

    const result = identifyCardsNeedingMigration(mockCards);

    assertEquals(result.cardsNeedingUpdate[0].title, '(untitled)');
    assertEquals(result.cardsNeedingUpdate[0].createdBy, '(unknown)');
    assertEquals(result.cardsNeedingUpdate[1].title, 'Card 2');
    assertEquals(result.cardsNeedingUpdate[1].createdBy, '(unknown)');
  });

  await test('should be safe to re-run after partial failure (idempotency)', () => {
    const allCards = [
      { id: 'card-1', data: () => ({ title: 'Card 1', isPublic: true }) },
      { id: 'card-2', data: () => ({ title: 'Card 2', isPublic: true }) },
      { id: 'card-3', data: () => ({ title: 'Card 3' }) },
      { id: 'card-4', data: () => ({ title: 'Card 4' }) },
    ];

    const result = identifyCardsNeedingMigration(allCards);
    assertEquals(result.cardsNeedingUpdate.length, 2);
    assertEquals(
      result.cardsNeedingUpdate.map((c) => c.id),
      ['card-3', 'card-4']
    );
  });

  // ============================================
  // splitIntoBatches tests
  // ============================================
  console.log('\nsplitIntoBatches:');

  await test('should split 1200 cards into 3 batches (500 + 500 + 200)', () => {
    const mockCards = Array.from({ length: 1200 }, (_, i) => ({ id: `card-${i}` }));
    const batches = splitIntoBatches(mockCards);

    assertEquals(batches.length, 3);
    assertEquals(batches[0].length, 500);
    assertEquals(batches[1].length, 500);
    assertEquals(batches[2].length, 200);
  });

  await test('should create single batch when count equals batch size', () => {
    const mockCards = Array.from({ length: 500 }, (_, i) => ({ id: `card-${i}` }));
    const batches = splitIntoBatches(mockCards);

    assertEquals(batches.length, 1);
    assertEquals(batches[0].length, 500);
  });

  await test('should create single batch when count is less than batch size', () => {
    const mockCards = Array.from({ length: 123 }, (_, i) => ({ id: `card-${i}` }));
    const batches = splitIntoBatches(mockCards);

    assertEquals(batches.length, 1);
    assertEquals(batches[0].length, 123);
  });

  await test('should return empty array for empty input', () => {
    const batches = splitIntoBatches([]);
    assertEquals(batches.length, 0);
  });

  await test('should respect custom batch size parameter', () => {
    const mockCards = Array.from({ length: 100 }, (_, i) => ({ id: `card-${i}` }));
    const batches = splitIntoBatches(mockCards, 30);

    assertEquals(batches.length, 4);
    assertEquals(batches[0].length, 30);
    assertEquals(batches[1].length, 30);
    assertEquals(batches[2].length, 30);
    assertEquals(batches[3].length, 10);
  });

  // ============================================
  // executeBatchMigration tests
  // ============================================
  console.log('\nexecuteBatchMigration:');

  await test('should return early with dryRun flag without committing', async () => {
    const mockBatch = createMockBatch();
    const mockDb = createMockDb(mockBatch);
    const mockCardsRef = createMockCardsRef();

    const cardsNeedingUpdate = [
      { id: 'card-1', title: 'Card 1' },
      { id: 'card-2', title: 'Card 2' },
    ];

    const result = await executeBatchMigration(mockDb, mockCardsRef, cardsNeedingUpdate, {
      dryRun: true,
    });

    assertEquals(result.success, true);
    assertEquals(result.updatedCount, 0);
    assertEquals(result.dryRun, true);
  });

  await test('should successfully migrate all cards in single batch', async () => {
    const mockBatch = createMockBatch();
    const mockDb = createMockDb(mockBatch);
    const mockCardsRef = createMockCardsRef();

    const cardsNeedingUpdate = [
      { id: 'card-1', title: 'Card 1' },
      { id: 'card-2', title: 'Card 2' },
    ];
    const mockTimestamp = { _seconds: 123 };

    const result = await executeBatchMigration(mockDb, mockCardsRef, cardsNeedingUpdate, {
      getServerTimestamp: () => mockTimestamp,
    });

    assertEquals(result.success, true);
    assertEquals(result.updatedCount, 2);
    assertEquals(mockBatch._updateCalls.length, 2);
  });

  await test('should process multiple batches for large card count', async () => {
    let commitCount = 0;
    const mockBatch = {
      update: () => {},
      commit: () => {
        commitCount++;
        return Promise.resolve();
      },
    };
    const mockDb = { batch: () => mockBatch };
    const mockCardsRef = createMockCardsRef();

    const cardsNeedingUpdate = Array.from({ length: 750 }, (_, i) => ({
      id: `card-${i}`,
      title: `Card ${i}`,
    }));

    const result = await executeBatchMigration(mockDb, mockCardsRef, cardsNeedingUpdate, {
      getServerTimestamp: () => ({ _seconds: 123 }),
    });

    assertEquals(result.success, true);
    assertEquals(result.updatedCount, 750);
    assertEquals(commitCount, 2); // 750 cards = 2 batches (500 + 250)
  });

  await test('should fail fast on first batch error', async () => {
    const error = new Error('Firestore write failed');
    error.code = 'unavailable';

    let commitCount = 0;
    const mockBatch = {
      update: () => {},
      commit: () => {
        commitCount++;
        if (commitCount === 2) {
          return Promise.reject(error);
        }
        return Promise.resolve();
      },
    };
    const mockDb = { batch: () => mockBatch };
    const mockCardsRef = createMockCardsRef();

    const cardsNeedingUpdate = Array.from({ length: 1000 }, (_, i) => ({
      id: `card-${i}`,
      title: `Card ${i}`,
    }));

    const result = await executeBatchMigration(mockDb, mockCardsRef, cardsNeedingUpdate, {
      getServerTimestamp: () => ({ _seconds: 123 }),
    });

    assertEquals(result.success, false);
    assertEquals(result.updatedCount, 500); // Only first batch succeeded
    assertEquals(result.error, error);
    assertEquals(result.failedBatchNum, 2);
    assertEquals(result.failedCardIds.length, 500);
  });

  await test('should include card IDs in error result for debugging', async () => {
    const error = new Error('Permission denied');
    error.code = 'permission-denied';

    const mockBatch = {
      update: () => {},
      commit: () => Promise.reject(error),
    };
    const mockDb = { batch: () => mockBatch };
    const mockCardsRef = createMockCardsRef();

    const cardsNeedingUpdate = [
      { id: 'card-1', title: 'Card 1' },
      { id: 'card-2', title: 'Card 2' },
    ];

    const result = await executeBatchMigration(mockDb, mockCardsRef, cardsNeedingUpdate, {
      getServerTimestamp: () => ({ _seconds: 123 }),
    });

    assertEquals(result.success, false);
    assertEquals(result.failedCardIds, ['card-1', 'card-2']);
    assertEquals(result.error.code, 'permission-denied');
  });

  await test('should add _migratedIsPublic audit field for tracking', async () => {
    const mockTimestamp = { _type: 'serverTimestamp' };
    let capturedData = null;

    const mockBatch = {
      update: (ref, data) => {
        capturedData = data;
      },
      commit: () => Promise.resolve(),
    };
    const mockDb = { batch: () => mockBatch };
    const mockCardsRef = createMockCardsRef();

    const cardsNeedingUpdate = [{ id: 'card-1', title: 'Card 1' }];

    await executeBatchMigration(mockDb, mockCardsRef, cardsNeedingUpdate, {
      getServerTimestamp: () => mockTimestamp,
    });

    assertTrue(capturedData !== null, 'Should have captured update data');
    assertEquals(capturedData.isPublic, true);
    assertEquals(capturedData._migratedIsPublic, mockTimestamp);
    assertEquals(capturedData.lastModifiedAt, mockTimestamp);
    assertEquals(capturedData.lastModifiedBy, 'migration-script');
  });

  // ============================================
  // Integration: Full Migration Flow
  // ============================================
  console.log('\nIntegration: Full Migration Flow:');

  await test('should handle complete migration workflow', async () => {
    // Step 1: Identify cards needing migration
    const mockCards = [
      { id: 'card-1', data: () => ({ title: 'Card 1' }) },
      { id: 'card-2', data: () => ({ title: 'Card 2', isPublic: true }) },
      { id: 'card-3', data: () => ({ title: 'Card 3' }) },
    ];

    const { cardsNeedingUpdate, cardsAlreadyHaveField } = identifyCardsNeedingMigration(mockCards);

    assertEquals(cardsNeedingUpdate.length, 2);
    assertEquals(cardsAlreadyHaveField.length, 1);

    // Step 2: Execute batch migration
    const mockBatch = createMockBatch();
    const mockDb = createMockDb(mockBatch);
    const mockCardsRef = createMockCardsRef();

    const result = await executeBatchMigration(mockDb, mockCardsRef, cardsNeedingUpdate, {
      getServerTimestamp: () => ({ _seconds: Date.now() }),
    });

    assertEquals(result.success, true);
    assertEquals(result.updatedCount, 2);
  });

  await test('should report batch progress during migration', async () => {
    const commitCalls = [];
    const mockBatch = {
      update: () => {},
      commit: () => {
        commitCalls.push(Date.now());
        return Promise.resolve();
      },
    };
    const mockDb = { batch: () => mockBatch };
    const mockCardsRef = createMockCardsRef();

    const cardsNeedingUpdate = Array.from({ length: 1200 }, (_, i) => ({
      id: `card-${i}`,
      title: `Card ${i}`,
    }));

    const result = await executeBatchMigration(mockDb, mockCardsRef, cardsNeedingUpdate, {
      getServerTimestamp: () => ({ _seconds: 123 }),
    });

    assertEquals(result.success, true);
    assertEquals(result.updatedCount, 1200);
    assertEquals(commitCalls.length, 3); // 3 batches committed
  });

  await test('should handle cards with various data shapes', () => {
    const mockCards = [
      { id: 'minimal', data: () => ({}) },
      { id: 'partial', data: () => ({ title: 'Partial' }) },
      { id: 'full', data: () => ({ title: 'Full', createdBy: 'user-1', description: 'A card' }) },
      { id: 'migrated', data: () => ({ title: 'Migrated', isPublic: true }) },
    ];

    const { cardsNeedingUpdate } = identifyCardsNeedingMigration(mockCards);

    assertEquals(cardsNeedingUpdate.length, 3);
    assertEquals(cardsNeedingUpdate[0], {
      id: 'minimal',
      title: '(untitled)',
      createdBy: '(unknown)',
    });
    assertEquals(cardsNeedingUpdate[1], {
      id: 'partial',
      title: 'Partial',
      createdBy: '(unknown)',
    });
    assertEquals(cardsNeedingUpdate[2], {
      id: 'full',
      title: 'Full',
      createdBy: 'user-1',
    });
  });

  // Print summary
  console.log('\n' + '='.repeat(50));
  console.log(`Total Tests: ${totalTests}`);
  console.log(`Passed: ${passedTests}`);
  console.log(`Failed: ${failedTests}`);
  console.log('='.repeat(50) + '\n');

  if (failedTests > 0) {
    console.error(`❌ ${failedTests} test(s) failed\n`);
    process.exit(1);
  } else {
    console.log('✅ All tests passed!\n');
    process.exit(0);
  }
}

runTests().catch((error) => {
  console.error('Test runner failed:', error);
  process.exit(1);
});
