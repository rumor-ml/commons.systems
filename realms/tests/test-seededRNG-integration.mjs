/**
 * Integration test: Verify SeededRNG state methods work with MythicBastionlandRealms pattern
 */

import { SeededRNG } from '../site/src/lib/seededRandom.js';

console.log('Testing SeededRNG getState/setState for MythicBastionlandRealms compatibility...\n');

// Simulate MythicBastionlandRealms usage pattern
const rng = new SeededRNG(12345);

// Simulate some map generation
console.log('1. Generating initial map...');
const hex1 = { terrain: rng.choice(['plains', 'forest', 'mountain']), roll: rng.next() };
const hex2 = { terrain: rng.choice(['plains', 'forest', 'mountain']), roll: rng.next() };
console.log(`   Generated hexes: ${hex1.terrain}, ${hex2.terrain}`);

// Save state (like createSnapshot in MythicBastionlandRealms line 1295)
console.log('\n2. Saving RNG state...');
const savedState = rng.getState();
console.log(`   Saved state: ${savedState}`);

// Generate more content
console.log('\n3. Generating more hexes...');
const hex3 = { terrain: rng.choice(['plains', 'forest', 'mountain']), roll: rng.next() };
const hex4 = { terrain: rng.choice(['plains', 'forest', 'mountain']), roll: rng.next() };
console.log(`   Generated hexes: ${hex3.terrain}, ${hex4.terrain}`);

// Restore state (like restoreSnapshot in MythicBastionlandRealms line 1375)
console.log('\n4. Restoring RNG state...');
rng.setState(savedState);
console.log(`   Restored state: ${savedState}`);

// Verify we get same sequence
console.log('\n5. Regenerating hexes from saved state...');
const hex3_restored = { terrain: rng.choice(['plains', 'forest', 'mountain']), roll: rng.next() };
const hex4_restored = { terrain: rng.choice(['plains', 'forest', 'mountain']), roll: rng.next() };
console.log(`   Regenerated hexes: ${hex3_restored.terrain}, ${hex4_restored.terrain}`);

// Verify match
const match =
  hex3.terrain === hex3_restored.terrain &&
  hex4.terrain === hex4_restored.terrain &&
  hex3.roll === hex3_restored.roll &&
  hex4.roll === hex4_restored.roll;

if (match) {
  console.log('\n✓ SUCCESS: Restored RNG produces identical sequence\!');
  console.log('  getState/setState work correctly for undo/redo functionality.');
  process.exit(0);
} else {
  console.log('\n✗ FAILURE: Restored RNG does not match original sequence\!');
  console.log(`  Original: [${hex3.terrain}, ${hex4.terrain}]`);
  console.log(`  Restored: [${hex3_restored.terrain}, ${hex4_restored.terrain}]`);
  process.exit(1);
}
