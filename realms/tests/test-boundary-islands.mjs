/**
 * Test for boundary island bug fix
 * Verifies that no isolated border hexes exist (all borders must connect to outer edge)
 */

import { expect } from 'chai';
import { SeededRNG } from '../site/src/lib/seededRandom.js';
import {
  hexKey,
  hexNeighbors,
  hexDistance,
  parseHexKey,
} from '../site/src/lib/hexMath.js';
import { validateBorderConnectivity } from '../site/src/lib/realmGeneration.js';

// Minimal RealmGenerator simulation for testing
class TestRealmGenerator {
  constructor(seed) {
    this.seed = seed;
    this.rng = new SeededRNG(seed);
    this.hexes = new Map();
    this.borderHexes = new Set();
    this.realmRadius = 8;
  }

  // Simplified initialization for testing
  generateBorders() {
    const radius = this.realmRadius + 2;

    // Generate some border hexes including potentially isolated ones
    for (let q = -radius; q <= radius; q++) {
      for (let r = -radius; r <= radius; r++) {
        const dist = hexDistance(0, 0, q, r);

        if (dist >= this.realmRadius && dist <= radius) {
          // Create border hex with some probability
          if (this.rng.next() < 0.3) {
            const key = hexKey(q, r);
            this.hexes.set(key, {
              q,
              r,
              isBorder: true,
              borderType: 'sea',
              revealed: false,
            });
            this.borderHexes.add(key);
          }
        }
      }
    }

    // Apply the fix - validate and remove isolated borders
    const ctx = {
      hexes: this.hexes,
      borderHexes: this.borderHexes,
      realmRadius: this.realmRadius,
    };
    validateBorderConnectivity(ctx);
  }

  checkBorderConnectivity() {
    if (this.borderHexes.size === 0) {
      return { hasIslands: false, islands: [] };
    }

    // Find all anchor points (borders at outer edge)
    const anchored = new Set();
    const outerThreshold = this.realmRadius + 1;

    for (const key of this.borderHexes) {
      const { q, r } = parseHexKey(key);
      const dist = hexDistance(0, 0, q, r);
      if (dist >= outerThreshold) {
        anchored.add(key);
      }
    }

    // BFS from anchored borders to find all connected borders
    const visited = new Set(anchored);
    const queue = [...anchored];

    while (queue.length > 0) {
      const currentKey = queue.shift();
      const { q, r } = parseHexKey(currentKey);
      const neighbors = hexNeighbors(q, r);

      for (const n of neighbors) {
        const nKey = hexKey(n.q, n.r);
        if (!visited.has(nKey) && this.borderHexes.has(nKey)) {
          visited.add(nKey);
          queue.push(nKey);
        }
      }
    }

    // Find island borders (in borderHexes but not visited)
    const islands = [...this.borderHexes].filter(k => !visited.has(k));

    return {
      hasIslands: islands.length > 0,
      islands,
    };
  }
}

// Run test
console.log('Testing boundary island detection...\n');

const testSeeds = [12345, 23456, 34567, 45678, 56789];
let totalIslands = 0;

for (const seed of testSeeds) {
  const generator = new TestRealmGenerator(seed);
  generator.generateBorders();

  const result = generator.checkBorderConnectivity();

  console.log(`Seed ${seed}:`);
  console.log(`  Total borders: ${generator.borderHexes.size}`);
  console.log(`  Islands found: ${result.islands.length}`);

  if (result.hasIslands) {
    console.log(`  Island locations: ${result.islands.join(', ')}`);
    totalIslands += result.islands.length;
  }

  // Test passes if no islands
  expect(result.islands).to.have.length(0,
    `Found ${result.islands.length} boundary islands: ${result.islands.join(', ')}`);
}

console.log(`\n✓ All tests passed! No boundary islands found in ${testSeeds.length} test cases.`);

process.exit(0);
