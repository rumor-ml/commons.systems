#!/usr/bin/env node
/**
 * Test SeededRNG getState/setState functionality
 * Verifies that state can be saved and restored for undo/redo functionality
 */

import { SeededRNG } from '../site/src/lib/seededRandom.js';

function test(name, fn) {
  try {
    fn();
    console.log(`✓ ${name}`);
  } catch (error) {
    console.error(`✗ ${name}`);
    console.error(`  ${error.message}`);
    process.exit(1);
  }
}

function assertEquals(actual, expected, message) {
  if (actual !== expected) {
    throw new Error(`${message}: expected ${expected}, got ${actual}`);
  }
}

// Test 1: getState returns current state
test('getState returns current state', () => {
  const rng = new SeededRNG(12345);
  const initialState = rng.getState();
  assertEquals(initialState, 12345, 'Initial state should equal seed');
});

// Test 2: getState returns updated state after next()
test('getState returns updated state after next()', () => {
  const rng = new SeededRNG(12345);
  rng.next();
  const state = rng.getState();
  assertEquals(state !== 12345, true, 'State should change after next()');
});

// Test 3: setState restores state
test('setState restores state', () => {
  const rng = new SeededRNG(12345);

  // Generate some random numbers
  rng.next();
  const savedState = rng.getState();
  const nextValue = rng.next();

  // Continue generating more numbers
  rng.next();
  rng.next();

  // Restore to saved state
  rng.setState(savedState);
  const restoredValue = rng.next();

  assertEquals(restoredValue, nextValue, 'Restored RNG should produce same sequence');
});

// Test 4: Multiple save/restore cycles
test('Multiple save/restore cycles work correctly', () => {
  const rng = new SeededRNG(99999);

  const checkpoint1 = rng.getState();
  const val1 = rng.next();

  const checkpoint2 = rng.getState();
  const val2 = rng.next();

  const checkpoint3 = rng.getState();
  rng.next();

  // Restore to checkpoint 2
  rng.setState(checkpoint2);
  assertEquals(rng.next(), val2, 'Should restore to checkpoint 2');

  // Restore to checkpoint 1
  rng.setState(checkpoint1);
  assertEquals(rng.next(), val1, 'Should restore to checkpoint 1');

  // Restore to checkpoint 3
  rng.setState(checkpoint3);
  // Just verify it doesn't throw
});

// Test 5: State independence (returned state doesn't affect RNG)
test('getState returns independent value', () => {
  const rng = new SeededRNG(54321);
  rng.next();

  const state = rng.getState();
  const nextValue1 = rng.next();

  // Reset to saved state
  rng.setState(state);
  const nextValue2 = rng.next();

  assertEquals(nextValue1, nextValue2, 'State should be independent');
});

// Test 6: Integration test matching MythicBastionlandRealms usage
test('Integration test: save/restore pattern like MythicBastionlandRealms', () => {
  const rng = new SeededRNG(42);

  // Generate some numbers
  const nums1 = [rng.next(), rng.next(), rng.next()];

  // Save state (like createSnapshot)
  const savedState = rng.getState();

  // Generate more numbers
  const nums2 = [rng.next(), rng.next()];

  // Restore state (like restoreSnapshot)
  rng.setState(savedState);

  // Should produce same sequence as nums2
  const restoredNums = [rng.next(), rng.next()];

  assertEquals(restoredNums[0], nums2[0], 'First restored number should match');
  assertEquals(restoredNums[1], nums2[1], 'Second restored number should match');
});

console.log('\nAll SeededRNG state tests passed! ✓');
