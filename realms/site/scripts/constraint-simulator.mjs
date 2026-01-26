#!/usr/bin/env node

/**
 * Constraint Baseline Simulation Suite
 *
 * Runs multiple realm generation simulations to establish baseline metrics
 * for constraint compliance and optimization quality.
 *
 * Usage:
 *   node tmp/baseline-simulator.mjs [options]
 *
 * Options:
 *   --count N        Number of simulations (default: 20)
 *   --start-seed N   Starting seed (default: 12345)
 *   --max-steps N    Max steps per simulation (default: 500)
 *   --output FILE    Output file for results (default: tmp/baseline-results.json)
 *   --quiet          Suppress progress output
 */

import { readFileSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Parse command line arguments
const args = process.argv.slice(2);
const config = {
  count: 20,
  startSeed: 12345,
  maxSteps: 500,
  output: 'tmp/baseline-results.json',
  quiet: false,
};

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--count' && args[i + 1]) config.count = parseInt(args[i + 1]);
  if (args[i] === '--start-seed' && args[i + 1]) config.startSeed = parseInt(args[i + 1]);
  if (args[i] === '--max-steps' && args[i + 1]) config.maxSteps = parseInt(args[i + 1]);
  if (args[i] === '--output' && args[i + 1]) config.output = args[i + 1];
  if (args[i] === '--quiet') config.quiet = true;
}

// Simple seeded random number generator
class SeededRandom {
  constructor(seed) {
    this.seed = seed;
  }

  random() {
    const x = Math.sin(this.seed++) * 10000;
    return x - Math.floor(x);
  }

  choice(array) {
    return array[Math.floor(this.random() * array.length)];
  }

  randint(min, max) {
    return Math.floor(this.random() * (max - min + 1)) + min;
  }

  weightedChoice(array, weights) {
    const total = weights.reduce((a, b) => a + b, 0);
    let roll = this.random() * total;
    for (let i = 0; i < array.length; i++) {
      roll -= weights[i];
      if (roll <= 0) return array[i];
    }
    return array[array.length - 1];
  }
}

// Hex distance calculation (axial coordinates)
function hexDistance(q1, r1, q2, r2) {
  return (Math.abs(q1 - q2) + Math.abs(q1 + r1 - q2 - r2) + Math.abs(r1 - r2)) / 2;
}

// Load the generator code and create a minimal execution environment
function loadGenerator() {
  const generatorPath = join(__dirname, '../realms/site/src/islands/MythicBastionlandRealms.jsx');
  const code = readFileSync(generatorPath, 'utf-8');

  // Extract the RealmGenerator class
  // This is a simplified approach - we'll need to mock the browser environment

  // Create a minimal DOM-like environment
  const mockCanvas = {
    getContext: () => ({
      clearRect: () => {},
      fillRect: () => {},
      strokeRect: () => {},
      beginPath: () => {},
      moveTo: () => {},
      lineTo: () => {},
      closePath: () => {},
      fill: () => {},
      stroke: () => {},
      arc: () => {},
      save: () => {},
      restore: () => {},
      translate: () => {},
      scale: () => {},
      rotate: () => {},
      setTransform: () => {},
      fillText: () => {},
      measureText: () => ({ width: 0 }),
    }),
    width: 800,
    height: 600,
  };

  const mockDocument = {
    createElement: (tag) => mockCanvas,
    getElementById: () => mockCanvas,
  };

  // Create globals
  global.document = mockDocument;
  global.window = global;

  // We need to extract and evaluate the generator class
  // For now, let's create a simplified version based on the structure

  return { SeededRandom };
}

// Simplified RealmGenerator for simulation
// This extracts the core logic without UI dependencies
class RealmGenerator {
  constructor(seed) {
    this.rng = new SeededRandom(seed);
    this.seed = seed;

    // Core data structures
    this.hexes = new Map();
    this.exploredHexes = new Set();
    this.revealedHexes = new Set();
    this.borderHexes = new Set();
    this.lakes = [];
    this.riverEdges = new Set();
    this.barrierEdges = new Set();
    this.terrainClusters = [];
    this.borderClusters = [];

    // Explorer state
    this.explorerPos = { q: 0, r: 0 };
    this.lastExplorerPos = null;

    // Constraints (initialized in initConstraints)
    this.constraints = null;
  }

  initConstraints() {
    this.constraints = {
      borderClosure: {
        complete: false,
        checking: false,
      },
      explorableHexes: {
        count: 0,
        min: 100,
        max: 180,
        target: 144,
      },
      holdings: {
        placed: 0,
        target: 4,
        positions: [],
        spacingViolations: 0,
      },
      mythSites: {
        placed: 0,
        target: 6,
        positions: [],
      },
      landmarks: {
        curse: { placed: 0, min: 3, max: 6, range: [3, 6] },
        dwelling: { placed: 0, min: 3, max: 6, range: [3, 6] },
        hazard: { placed: 0, min: 3, max: 6, range: [3, 6] },
        monument: { placed: 0, min: 3, max: 6, range: [3, 6] },
        ruin: { placed: 0, min: 3, max: 6, range: [3, 6] },
        sanctum: { placed: 0, min: 3, max: 6, range: [3, 6] },
      },
      lakes: {
        placed: 0,
        min: 2,
        max: 3,
        target: 2.5,
      },
      riverNetwork: {
        span: 0,
        targetSpan: 8,
      },
      barriers: {
        placed: 0,
        target: 24,
      },
      featureExclusivity: {
        violations: [],
        valid: true,
      },
      featureRegistry: new Set(), // Set of hex keys that have ANY exclusive feature
      realmDimensions: {
        minQ: 0,
        maxQ: 0,
        minR: 0,
        maxR: 0,
        width: 0,
        height: 0,
        targetWidth: 12,
        targetHeight: 12,
      },
    };
  }

  initialize(withVisualization = false) {
    this.initConstraints();

    // Create starting hex
    const startHex = {
      q: 0,
      r: 0,
      terrain: 'plains',
      isExplored: true,
      isRevealed: true,
      isBorder: false,
    };

    const key = this.hexKey(startHex);
    this.hexes.set(key, startHex);
    this.exploredHexes.add(key);
    this.revealedHexes.add(key);

    this.explorerPos = { q: 0, r: 0 };

    // Reveal neighbors
    this.getNeighbors(startHex).forEach((neighbor) => {
      const nKey = this.hexKey(neighbor);
      if (!this.hexes.has(nKey)) {
        const revealedHex = {
          q: neighbor.q,
          r: neighbor.r,
          terrain: this.generateTerrain(),
          isExplored: false,
          isRevealed: true,
          isBorder: false,
        };
        this.hexes.set(nKey, revealedHex);
        this.revealedHexes.add(nKey);
        this.borderHexes.add(nKey);
      }
    });

    this.updateRealmDimensions();
  }

  hexKey(hex) {
    return `${hex.q},${hex.r}`;
  }

  getNeighbors(hex) {
    const directions = [
      { q: 1, r: 0 },
      { q: 1, r: -1 },
      { q: 0, r: -1 },
      { q: -1, r: 0 },
      { q: -1, r: 1 },
      { q: 0, r: 1 },
    ];
    return directions.map((d) => ({ q: hex.q + d.q, r: hex.r + d.r }));
  }

  generateTerrain() {
    const terrains = ['plains', 'forest', 'hills', 'mountains', 'desert', 'swamp'];
    const weights = [30, 25, 20, 10, 10, 5];
    const total = weights.reduce((a, b) => a + b, 0);
    const roll = this.rng.random() * total;

    let cumulative = 0;
    for (let i = 0; i < terrains.length; i++) {
      cumulative += weights[i];
      if (roll < cumulative) return terrains[i];
    }
    return 'plains';
  }

  moveExplorer() {
    // HARD CONSTRAINT: Enforce max explorable
    if (this.exploredHexes.size >= this.constraints.explorableHexes.max) {
      // Mark border as closed when we hit the cap
      this.constraints.borderClosure.complete = true;
      this.forceCompleteFeatures(); // Ensure hard constraint features are placed
      return false;
    }

    // SOFT CONSTRAINT: Probabilistic early stopping at target ~144
    if (this.exploredHexes.size >= this.constraints.explorableHexes.target) {
      // Check if border is naturally closed - if so, always stop
      if (this.borderHexes.size === 0) {
        this.constraints.borderClosure.complete = true;
        this.forceCompleteFeatures();
        return false;
      }

      // Otherwise, probabilistically stop based on how much over target we are
      const excess = this.exploredHexes.size - this.constraints.explorableHexes.target;
      const stopProb = Math.min(0.95, 0.15 + excess * 0.02); // Start at 15%, increase with excess

      if (this.rng.random() < stopProb) {
        this.constraints.borderClosure.complete = true;
        this.forceCompleteFeatures();
        return false;
      }
    }

    // Check if border closed
    if (this.constraints.borderClosure.complete) {
      if (this.exploredHexes.size >= this.constraints.explorableHexes.min) {
        this.forceCompleteFeatures(); // Ensure hard constraint features are placed
        return false;
      }
    }

    // Select next hex from border
    if (this.borderHexes.size === 0) {
      this.constraints.borderClosure.complete = true;
      this.forceCompleteFeatures(); // Ensure hard constraint features are placed
      return false;
    }

    // SOFT CONSTRAINT: Compactness-biased movement - prefer hexes closer to center
    const borderArray = Array.from(this.borderHexes)
      .map((key) => this.hexes.get(key))
      .filter(Boolean);
    const centerQ = 0,
      centerR = 0;
    const weights = borderArray.map((hex) => {
      const dist = hexDistance(hex.q, hex.r, centerQ, centerR);
      return 1 / (1 + dist * 0.15);
    });
    const nextHex = this.rng.weightedChoice(borderArray, weights);

    if (!nextHex) return false;

    // Move explorer
    this.lastExplorerPos = { ...this.explorerPos };
    this.explorerPos = { q: nextHex.q, r: nextHex.r };

    // Mark as explored
    const nextHexKey = this.hexKey(nextHex);
    nextHex.isExplored = true;
    this.exploredHexes.add(nextHexKey);
    this.borderHexes.delete(nextHexKey);
    this.constraints.explorableHexes.count = this.exploredHexes.size;

    // Reveal neighbors
    this.getNeighbors(nextHex).forEach((neighbor) => {
      const nKey = this.hexKey(neighbor);
      if (!this.hexes.has(nKey)) {
        const revealedHex = {
          q: neighbor.q,
          r: neighbor.r,
          terrain: this.generateTerrain(),
          isExplored: false,
          isRevealed: true,
          isBorder: false,
        };
        this.hexes.set(nKey, revealedHex);
        this.revealedHexes.add(nKey);
        this.borderHexes.add(nKey);
      }
    });

    // Generate features (simplified)
    this.maybeGenerateFeatures(nextHex);

    // Update dimensions periodically
    if (this.exploredHexes.size % 5 === 0) {
      this.updateRealmDimensions();
    }

    // Validate feature exclusivity periodically
    if (this.exploredHexes.size % 10 === 0) {
      this.validateFeatureExclusivity();
    }

    // Check border closure periodically
    if (this.exploredHexes.size % 10 === 0) {
      this.checkBorderClosure();
    }

    return true;
  }

  maybeGenerateFeatures(hex) {
    const progress = this.exploredHexes.size / this.constraints.explorableHexes.target;
    const hexKey = this.hexKey(hex);

    // Check centralized registry FIRST (O(1) lookup)
    if (this.constraints.featureRegistry.has(hexKey)) {
      return; // Already has exclusive feature - prevent violation
    }

    // Holdings
    if (this.constraints.holdings.placed < this.constraints.holdings.target) {
      let prob = 0.03;
      if (progress > 0.7) {
        const deficit = this.constraints.holdings.target - this.constraints.holdings.placed;
        prob *= 1.0 + deficit * 2.5;
      }
      if (this.rng.random() < prob) {
        this.constraints.holdings.placed++;
        this.constraints.holdings.positions.push({ q: hex.q, r: hex.r });
        hex.hasHolding = true;
        this.constraints.featureRegistry.add(hexKey);
        return; // Exclusive feature placed
      }
    }

    // Myth sites
    if (this.constraints.mythSites.placed < this.constraints.mythSites.target) {
      let prob = 0.04;
      if (progress > 0.7) {
        const deficit = this.constraints.mythSites.target - this.constraints.mythSites.placed;
        prob *= 1.0 + deficit * 2.0;
      }
      if (this.rng.random() < prob) {
        this.constraints.mythSites.placed++;
        this.constraints.mythSites.positions.push({ q: hex.q, r: hex.r });
        hex.hasMythSite = true;
        this.constraints.featureRegistry.add(hexKey);
        return; // Exclusive feature placed
      }
    }

    // Landmarks
    for (const [type, data] of Object.entries(this.constraints.landmarks)) {
      if (data.placed < data.max) {
        let prob = 0.05;
        if (progress > 0.7 && data.placed < data.min) {
          const deficit = data.min - data.placed;
          prob *= 2.0 + deficit;
        }
        if (this.rng.random() < prob) {
          data.placed++;
          hex.feature = type;
          this.constraints.featureRegistry.add(hexKey);
          return; // Exclusive feature placed (and break from loop)
        }
      }
    }

    // Lakes - increased probability with deficit compensation
    if (this.constraints.lakes.placed < this.constraints.lakes.max) {
      const baseProb = 0.045; // Increased from 0.02
      const deficit = 2.5 - this.constraints.lakes.placed;
      const deficitBonus = deficit > 0 ? deficit * 0.015 : 0;
      if (this.rng.random() < baseProb + deficitBonus) {
        this.constraints.lakes.placed++;
        hex.isLake = true;
      }
    }

    // Rivers - stop extending once span target is met
    const currentSpan = this.constraints.riverNetwork.span;
    const hasMetSpanTarget = currentSpan >= this.constraints.riverNetwork.targetSpan;

    // If span target met, greatly reduce continuation probability
    if (!hasMetSpanTarget || this.rng.random() >= 0.6) {
      if (this.rng.random() < 0.05) {
        this.constraints.riverNetwork.span = Math.min(
          this.constraints.riverNetwork.span + this.rng.randint(1, 3),
          this.constraints.riverNetwork.targetSpan + 5
        );
      }
    }

    // Barriers - dynamic probability based on exploration progress
    const targetBarriers = 24;
    const targetHexes = this.constraints.explorableHexes.target; // 144
    const exploredRatio = Math.max(0.1, this.exploredHexes.size / targetHexes);
    const expectedBarriers = targetBarriers * exploredRatio;
    const barrierDeficit = expectedBarriers - this.constraints.barriers.placed;
    const barrierProb = Math.max(0.05, Math.min(0.25, 0.15 + barrierDeficit * 0.01));

    if (this.rng.random() < barrierProb) {
      this.constraints.barriers.placed++;
    }
  }

  updateRealmDimensions() {
    if (this.hexes.size === 0) return;

    let minQ = Infinity,
      maxQ = -Infinity;
    let minR = Infinity,
      maxR = -Infinity;

    for (const hex of this.hexes.values()) {
      minQ = Math.min(minQ, hex.q);
      maxQ = Math.max(maxQ, hex.q);
      minR = Math.min(minR, hex.r);
      maxR = Math.max(maxR, hex.r);
    }

    this.constraints.realmDimensions.minQ = minQ;
    this.constraints.realmDimensions.maxQ = maxQ;
    this.constraints.realmDimensions.minR = minR;
    this.constraints.realmDimensions.maxR = maxR;
    this.constraints.realmDimensions.width = maxQ - minQ + 1;
    this.constraints.realmDimensions.height = maxR - minR + 1;
  }

  validateFeatureExclusivity() {
    const violations = [];

    for (const hex of this.hexes.values()) {
      const features = [];
      if (hex.hasHolding) features.push('holding');
      if (hex.hasMythSite) features.push('myth_site');
      if (hex.feature) features.push(`landmark_${hex.feature}`);

      if (features.length > 1) {
        violations.push({ hex: `(${hex.q}, ${hex.r})`, features });
      }
    }

    this.constraints.featureExclusivity.violations = violations;
    this.constraints.featureExclusivity.valid = violations.length === 0;
  }

  checkBorderClosure() {
    // Simple check: if no border hexes, border is closed
    this.constraints.borderClosure.complete = this.borderHexes.size === 0;
  }

  /**
   * Force placement of any missing hard constraint features before exploration ends.
   * This guarantees holdings (4) and myth sites (6) are always placed.
   */
  forceCompleteFeatures() {
    // Get all valid hexes for forced placement
    // Must be: explored, not lake, no exclusive feature
    const validHexes = [];
    for (const key of this.exploredHexes) {
      const hex = this.hexes.get(key);
      if (hex && !hex.isLake && !this.constraints.featureRegistry.has(key)) {
        validHexes.push({ hex, key });
      }
    }

    // Shuffle for randomness using seeded RNG
    for (let i = validHexes.length - 1; i > 0; i--) {
      const j = Math.floor(this.rng.random() * (i + 1));
      [validHexes[i], validHexes[j]] = [validHexes[j], validHexes[i]];
    }

    // Force place missing myth sites (exactly 6 required)
    while (this.constraints.mythSites.placed < 6 && validHexes.length > 0) {
      const { hex, key } = validHexes.pop();
      if (
        !hex.hasMythSite &&
        !hex.hasHolding &&
        !hex.feature &&
        !this.constraints.featureRegistry.has(key)
      ) {
        hex.hasMythSite = true;
        this.constraints.mythSites.placed++;
        this.constraints.mythSites.positions.push({ q: hex.q, r: hex.r });
        this.constraints.featureRegistry.add(key);
      }
    }

    // Force place missing holdings (exactly 4 required)
    // Note: In the real generator this respects spacing constraints, but simplified here
    while (this.constraints.holdings.placed < 4 && validHexes.length > 0) {
      const { hex, key } = validHexes.pop();
      if (
        !hex.hasMythSite &&
        !hex.hasHolding &&
        !hex.feature &&
        !this.constraints.featureRegistry.has(key)
      ) {
        hex.hasHolding = true;
        this.constraints.holdings.placed++;
        this.constraints.holdings.positions.push({ q: hex.q, r: hex.r });
        this.constraints.featureRegistry.add(key);
      }
    }
  }

  validateHardConstraints() {
    const violations = [];

    // Border closure
    if (!this.constraints.borderClosure.complete && this.exploredHexes.size >= 100) {
      violations.push({ constraint: 'Border Closure', message: 'Border not fully closed' });
    }

    // Min explorable
    if (this.constraints.explorableHexes.count < this.constraints.explorableHexes.min) {
      violations.push({
        constraint: 'Min Explorable',
        message: `Only ${this.constraints.explorableHexes.count}/100 hexes`,
      });
    }

    // Max explorable
    if (this.constraints.explorableHexes.count > this.constraints.explorableHexes.max) {
      violations.push({
        constraint: 'Max Explorable',
        message: `${this.constraints.explorableHexes.count} exceeds max 180`,
      });
    }

    // Holdings count
    if (this.constraints.holdings.placed !== this.constraints.holdings.target) {
      violations.push({
        constraint: 'Holdings Count',
        message: `${this.constraints.holdings.placed}/4 placed`,
      });
    }

    // Myth sites count
    if (this.constraints.mythSites.placed !== this.constraints.mythSites.target) {
      violations.push({
        constraint: 'Myth Sites Count',
        message: `${this.constraints.mythSites.placed}/6 placed`,
      });
    }

    // Feature exclusivity
    if (!this.constraints.featureExclusivity.valid) {
      violations.push({
        constraint: 'Feature Exclusivity',
        message: `${this.constraints.featureExclusivity.violations.length} violations`,
      });
    }

    // Landmarks
    for (const [type, data] of Object.entries(this.constraints.landmarks)) {
      if (data.placed < data.min) {
        violations.push({
          constraint: `Landmarks (${type})`,
          message: `Only ${data.placed}/${data.min} placed`,
        });
      }
    }

    // Lakes
    if (this.constraints.lakes.placed > this.constraints.lakes.max) {
      violations.push({
        constraint: 'Lakes Max',
        message: `${this.constraints.lakes.placed} exceeds max 3`,
      });
    }

    return {
      valid: violations.length === 0,
      violations,
    };
  }
}

// Run a single simulation
async function runSimulation(seed, maxSteps, quiet = false) {
  if (!quiet) {
    process.stdout.write(`  Seed ${seed}: `);
  }

  const generator = new RealmGenerator(seed);
  generator.initialize(false);

  let steps = 0;
  let completed = false;

  while (steps < maxSteps) {
    const canMove = generator.moveExplorer();
    steps++;

    if (!canMove) {
      completed = true;
      break;
    }

    if (!quiet && steps % 50 === 0) {
      process.stdout.write('.');
    }
  }

  const validation = generator.validateHardConstraints();

  if (!quiet) {
    const status = validation.valid ? '✓' : '✗';
    console.log(` ${status} (${steps} steps, ${generator.exploredHexes.size} hexes)`);
  }

  // Collect results
  const c = generator.constraints;
  return {
    seed,
    steps,
    completed,

    hard: {
      borderClosure: c.borderClosure.complete,
      minExplorable: c.explorableHexes.count >= c.explorableHexes.min,
      maxExplorable: c.explorableHexes.count <= c.explorableHexes.max,
      holdingsCount: c.holdings.placed === c.holdings.target,
      mythSitesCount: c.mythSites.placed === c.mythSites.target,
      featureExclusivity: c.featureExclusivity.valid,
      lakesMax: c.lakes.placed <= c.lakes.max,
      landmarksCurse: c.landmarks.curse.placed >= c.landmarks.curse.min,
      landmarksDwelling: c.landmarks.dwelling.placed >= c.landmarks.dwelling.min,
      landmarksHazard: c.landmarks.hazard.placed >= c.landmarks.hazard.min,
      landmarksMonument: c.landmarks.monument.placed >= c.landmarks.monument.min,
      landmarksRuin: c.landmarks.ruin.placed >= c.landmarks.ruin.min,
      landmarksSanctum: c.landmarks.sanctum.placed >= c.landmarks.sanctum.min,
    },

    hardValues: {
      explorableCount: c.explorableHexes.count,
      holdingsPlaced: c.holdings.placed,
      mythSitesPlaced: c.mythSites.placed,
      featureExclusivityViolations: c.featureExclusivity.violations.length,
      lakesPlaced: c.lakes.placed,
      landmarksCurse: c.landmarks.curse.placed,
      landmarksDwelling: c.landmarks.dwelling.placed,
      landmarksHazard: c.landmarks.hazard.placed,
      landmarksMonument: c.landmarks.monument.placed,
      landmarksRuin: c.landmarks.ruin.placed,
      landmarksSanctum: c.landmarks.sanctum.placed,
    },

    soft: {
      explorableTarget: c.explorableHexes.count,
      realmWidth: c.realmDimensions.width,
      realmHeight: c.realmDimensions.height,
      riverSpan: c.riverNetwork.span,
      barriers: c.barriers.placed,
      lakes: c.lakes.placed,
    },

    validation,
  };
}

// Calculate statistics
function calculateStats(values) {
  if (values.length === 0) return { min: 0, max: 0, avg: 0, stddev: 0 };

  const min = Math.min(...values);
  const max = Math.max(...values);
  const avg = values.reduce((a, b) => a + b, 0) / values.length;

  const variance = values.reduce((sum, val) => sum + Math.pow(val - avg, 2), 0) / values.length;
  const stddev = Math.sqrt(variance);

  return {
    min,
    max,
    avg: parseFloat(avg.toFixed(2)),
    stddev: parseFloat(stddev.toFixed(2)),
  };
}

// Analyze results
function analyzeResults(results) {
  const analysis = {
    meta: {
      timestamp: new Date().toISOString(),
      simulations: results.length,
      config,
    },
    summary: {
      completedNaturally: results.filter((r) => r.completed).length,
      allHardConstraintsPass: results.filter((r) => r.validation.valid).length,
      averageSteps: parseFloat(
        (results.reduce((sum, r) => sum + r.steps, 0) / results.length).toFixed(1)
      ),
    },
    hardConstraints: {},
    softConstraints: {},
    rawResults: results,
  };

  // Hard constraints analysis
  const hardConstraints = [
    { name: 'borderClosure', key: 'borderClosure', target: true },
    { name: 'minExplorable', key: 'minExplorable', target: true },
    { name: 'maxExplorable', key: 'maxExplorable', target: true },
    { name: 'holdingsCount', key: 'holdingsCount', target: true },
    { name: 'mythSitesCount', key: 'mythSitesCount', target: true },
    { name: 'featureExclusivity', key: 'featureExclusivity', target: true },
    { name: 'lakesMax', key: 'lakesMax', target: true },
    { name: 'landmarksCurse', key: 'landmarksCurse', target: true },
    { name: 'landmarksDwelling', key: 'landmarksDwelling', target: true },
    { name: 'landmarksHazard', key: 'landmarksHazard', target: true },
    { name: 'landmarksMonument', key: 'landmarksMonument', target: true },
    { name: 'landmarksRuin', key: 'landmarksRuin', target: true },
    { name: 'landmarksSanctum', key: 'landmarksSanctum', target: true },
  ];

  const hardValueKeys = {
    borderClosure: 'explorableCount',
    minExplorable: 'explorableCount',
    maxExplorable: 'explorableCount',
    holdingsCount: 'holdingsPlaced',
    mythSitesCount: 'mythSitesPlaced',
    featureExclusivity: 'featureExclusivityViolations',
    lakesMax: 'lakesPlaced',
    landmarksCurse: 'landmarksCurse',
    landmarksDwelling: 'landmarksDwelling',
    landmarksHazard: 'landmarksHazard',
    landmarksMonument: 'landmarksMonument',
    landmarksRuin: 'landmarksRuin',
    landmarksSanctum: 'landmarksSanctum',
  };

  hardConstraints.forEach((constraint) => {
    const passes = results.filter((r) => r.hard[constraint.key] === constraint.target).length;
    const passRate = parseFloat(((passes / results.length) * 100).toFixed(1));

    const valueKey = hardValueKeys[constraint.key];
    const values = results.map((r) => r.hardValues[valueKey]);
    const stats = calculateStats(values);

    analysis.hardConstraints[constraint.name] = {
      passRate,
      passes,
      fails: results.length - passes,
      ...stats,
    };
  });

  // Soft constraints analysis
  const softConstraints = [
    { name: 'explorableTarget', key: 'explorableTarget', ideal: 144 },
    { name: 'realmWidth', key: 'realmWidth', ideal: 12 },
    { name: 'realmHeight', key: 'realmHeight', ideal: 12 },
    { name: 'riverSpan', key: 'riverSpan', ideal: 8 },
    { name: 'barriers', key: 'barriers', ideal: 24 },
    { name: 'lakes', key: 'lakes', ideal: 2.5 },
  ];

  softConstraints.forEach((constraint) => {
    const values = results.map((r) => r.soft[constraint.key]);
    const stats = calculateStats(values);

    // Calculate quality score
    const deviations = values.map((v) => Math.abs(v - constraint.ideal));
    const avgDeviation = deviations.reduce((a, b) => a + b, 0) / deviations.length;
    const qualityScore = parseFloat(
      Math.max(0, 100 - (avgDeviation / constraint.ideal) * 100).toFixed(1)
    );

    analysis.softConstraints[constraint.name] = {
      qualityScore,
      ideal: constraint.ideal,
      ...stats,
    };
  });

  // Overall metrics
  const totalHardChecks = hardConstraints.length * results.length;
  const passedHardChecks = results.reduce((sum, r) => {
    return sum + Object.values(r.hard).filter((v) => v === true).length;
  }, 0);

  analysis.summary.overallHardConstraintPassRate = parseFloat(
    ((passedHardChecks / totalHardChecks) * 100).toFixed(1)
  );

  return analysis;
}

// Print results to console
function printResults(analysis) {
  console.log('\n' + '='.repeat(80));
  console.log('CONSTRAINT BASELINE RESULTS');
  console.log('='.repeat(80));

  console.log('\n📊 SUMMARY');
  console.log(`  Simulations: ${analysis.meta.simulations}`);
  console.log(
    `  Completed naturally: ${analysis.summary.completedNaturally} (${((analysis.summary.completedNaturally / analysis.meta.simulations) * 100).toFixed(1)}%)`
  );
  console.log(
    `  All hard constraints pass: ${analysis.summary.allHardConstraintsPass} (${((analysis.summary.allHardConstraintsPass / analysis.meta.simulations) * 100).toFixed(1)}%)`
  );
  console.log(`  Average steps: ${analysis.summary.averageSteps}`);
  console.log(
    `  Overall hard constraint pass rate: ${analysis.summary.overallHardConstraintPassRate}%`
  );

  console.log('\n🔴 HARD CONSTRAINTS (must be 100%)');
  console.log('  Constraint                    Pass Rate   Min    Max    Avg    StdDev');
  console.log('  ' + '-'.repeat(74));

  Object.entries(analysis.hardConstraints).forEach(([name, data]) => {
    const status = data.passRate >= 95 ? '✓' : data.passRate >= 80 ? '⚠' : '✗';
    const nameFormatted = name.padEnd(28);
    const passRateFormatted = `${data.passRate}%`.padEnd(10);
    const minFormatted = data.min.toString().padEnd(6);
    const maxFormatted = data.max.toString().padEnd(6);
    const avgFormatted = data.avg.toString().padEnd(6);
    const stddevFormatted = data.stddev.toString().padEnd(6);

    console.log(
      `  ${status} ${nameFormatted} ${passRateFormatted} ${minFormatted} ${maxFormatted} ${avgFormatted} ${stddevFormatted}`
    );
  });

  console.log('\n🟣 SOFT CONSTRAINTS (should be optimized)');
  console.log('  Constraint                    Quality     Min    Max    Avg    StdDev  Ideal');
  console.log('  ' + '-'.repeat(80));

  Object.entries(analysis.softConstraints).forEach(([name, data]) => {
    const status =
      data.qualityScore >= 90
        ? '🌟'
        : data.qualityScore >= 70
          ? '✓'
          : data.qualityScore >= 50
            ? '⚠'
            : '✗';
    const nameFormatted = name.padEnd(28);
    const qualityFormatted = `${data.qualityScore}/100`.padEnd(10);
    const minFormatted = data.min.toString().padEnd(6);
    const maxFormatted = data.max.toString().padEnd(6);
    const avgFormatted = data.avg.toString().padEnd(6);
    const stddevFormatted = data.stddev.toString().padEnd(6);
    const idealFormatted = data.ideal.toString().padEnd(6);

    console.log(
      `  ${status} ${nameFormatted} ${qualityFormatted} ${minFormatted} ${maxFormatted} ${avgFormatted} ${stddevFormatted} ${idealFormatted}`
    );
  });

  console.log('\n' + '='.repeat(80));
}

// Main execution
async function main() {
  console.log('🎲 Constraint Baseline Simulation Suite\n');
  console.log(`Configuration:`);
  console.log(`  Simulations: ${config.count}`);
  console.log(`  Starting seed: ${config.startSeed}`);
  console.log(`  Max steps: ${config.maxSteps}`);
  console.log(`  Output: ${config.output}\n`);

  console.log('Running simulations...\n');

  const results = [];
  for (let i = 0; i < config.count; i++) {
    const seed = config.startSeed + i;
    const result = await runSimulation(seed, config.maxSteps, config.quiet);
    results.push(result);
  }

  console.log('\nAnalyzing results...');
  const analysis = analyzeResults(results);

  // Print results
  printResults(analysis);

  // Save to file
  console.log(`\nSaving results to ${config.output}...`);
  writeFileSync(config.output, JSON.stringify(analysis, null, 2));
  console.log('✓ Results saved\n');

  // Return exit code based on hard constraint pass rate
  const exitCode = analysis.summary.overallHardConstraintPassRate >= 90 ? 0 : 1;
  process.exit(exitCode);
}

main().catch((err) => {
  console.error('Error:', err);
  process.exit(1);
});
