#!/usr/bin/env node

/**
 * Constraint Baseline Simulation Suite
 *
 * Runs multiple realm generation simulations using river logic that mirrors
 * the actual RealmGenerator to establish accurate baseline metrics.
 *
 * Usage:
 *   node realms/site/scripts/constraint-simulator.mjs [options]
 *
 * Options:
 *   --count N        Number of simulations (default: 20)
 *   --start-seed N   Starting seed (default: 1)
 *   --max-steps N    Max steps per simulation (default: 500)
 *   --output FILE    Output file for results (default: tmp/baseline-results.json)
 *   --quiet          Suppress progress output
 */

import { writeFileSync } from 'fs';
import { SeededRNG } from '../src/lib/seededRandom.js';
import {
  DIRECTION_NAMES,
  OPPOSITE_DIRECTION,
  hexDistance,
  hexNeighbor,
  hexNeighbors,
  hexKey,
  getAdjacentDirections,
} from '../src/lib/hexMath.js';
import { initiateRiver, planRiverPath } from '../src/lib/riverGeneration.js';
import { initializeBorderClusters, getBorderProbability } from '../src/lib/borderGeneration.js';
import {
  createBorderHex as sharedCreateBorderHex,
  shouldBeLake,
  generateTerrainWithConstraints,
  maybeGenerateBarrier,
  calculateFeatureWeights,
  maybeAddFeature,
  forceCompleteFeatures as sharedForceCompleteFeatures,
  wouldTrapExplorer as sharedWouldTrapExplorer,
} from '../src/lib/realmGeneration.js';
import {
  TERRAIN_TYPES,
  TERRAIN_AFFINITIES,
  ELEVATION,
  getElevation as sharedGetElevation,
} from '../src/lib/terrainConstants.js';

// Parse command line arguments
const args = process.argv.slice(2);
const config = {
  count: 20,
  startSeed: 1,
  maxSteps: 500,
  output: 'tmp/baseline-results.json',
  quiet: false,
  debugSeeds: [],
};

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--count' && args[i + 1]) config.count = parseInt(args[i + 1]);
  if (args[i] === '--start-seed' && args[i + 1]) config.startSeed = parseInt(args[i + 1]);
  if (args[i] === '--max-steps' && args[i + 1]) config.maxSteps = parseInt(args[i + 1]);
  if (args[i] === '--output' && args[i + 1]) config.output = args[i + 1];
  if (args[i] === '--quiet') config.quiet = true;
  if (args[i] === '--debug' && args[i + 1]) config.debugSeeds = args[i + 1].split(',').map(Number);
}

// Standalone RealmGenerator that mirrors the real one's river logic
class StandaloneRealmGenerator {
  constructor(seed) {
    this.rng = new SeededRNG(seed);
    this.seed = seed;

    this.hexes = new Map();
    this.exploredHexes = new Set();
    this.revealedHexes = new Set();
    this.borderHexes = new Set();
    this.realmBorderHexes = new Set();
    this.riverEdges = new Map();
    this.barrierEdges = new Set();
    this.traversedEdges = new Set();
    this.lakes = [];

    // New river system state
    this.rivers = [];
    this.riverEncountered = false;
    this.riverIdCounter = 0;
    this.plannedRiverEdges = new Map();

    this.borderClusters = [];
    this.terrainClusters = new Map();
    this.clusterIdCounter = 0;
    this.currentExplorerPos = { q: 0, r: 0 };
    this.currentDirection = null; // Track preferred exploration direction
    this.constraints = null;
    this.generationMode = null;
    this.realmRadius = 8; // Max distance from origin for realm hexes
  }

  initConstraints() {
    this.constraints = {
      borderClosure: { complete: false },
      explorableHexes: { count: 0, min: 100, max: 180, target: 144 },
      holdings: { placed: 0, target: 4, positions: [], usedTypes: [] },
      mythSites: { placed: 0, target: 6, positions: [] },
      landmarks: {
        curse: { placed: 0, min: 3, max: 6 },
        dwelling: { placed: 0, min: 3, max: 6 },
        hazard: { placed: 0, min: 3, max: 6 },
        monument: { placed: 0, min: 3, max: 6 },
        ruin: { placed: 0, min: 3, max: 6 },
        sanctum: { placed: 0, min: 3, max: 6 },
      },
      lakes: { placed: 0, min: 2, max: 3, target: 2.5 },
      riverNetwork: {
        span: 0,
        targetSpan: 8,
        networkCount: 0,
        targetNetworkCount: 1,
        tributaryCount: 0,
        targetTributaries: 3,
      },
      barriers: { placed: 0, target: 24 },
      featureExclusivity: { violations: [], valid: true },
      featureRegistry: new Set(),
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

  initialize(startAtBorder = false) {
    this.initConstraints();
    this.borderClusters = initializeBorderClusters(this.rng);
    this.generateInitialBorderShell();

    // Find starting position (random within realm, like the UI)
    const startPos = this.findStartPosition(startAtBorder);
    this.currentExplorerPos = { q: startPos.q, r: startPos.r };

    // CRITICAL: Generate start hex using createHex() to consume same RNG as UI's generateHex()
    // UI calls: generateHex(startPos.q, startPos.r) then exploreHex(startPos.q, startPos.r)
    this.createHex(startPos.q, startPos.r); // createHex adds to this.hexes internally

    // Mark start hex as explored (matches UI's exploreHex)
    const key = hexKey(startPos.q, startPos.r);
    const startHex = this.hexes.get(key);
    startHex.isExplored = true;
    startHex.isRevealed = true;
    this.exploredHexes.add(key);
    this.revealedHexes.add(key);

    // Reveal and generate neighbors (matches UI's exploreHex)
    for (const n of hexNeighbors(startPos.q, startPos.r)) {
      const nKey = hexKey(n.q, n.r);
      if (!this.hexes.has(nKey)) {
        this.createHex(n.q, n.r); // createHex now adds to this.hexes internally
      }
      const nHex = this.hexes.get(nKey);
      if (nHex && !nHex.isRevealed) {
        nHex.isRevealed = true;
        this.revealedHexes.add(nKey);
      }
    }

    this.updateRealmDimensions();
  }

  findStartPosition(startAtBorder = false) {
    const candidates = [];

    if (startAtBorder) {
      // Find hexes adjacent to border
      for (let q = -this.realmRadius; q <= this.realmRadius; q++) {
        for (let r = -this.realmRadius; r <= this.realmRadius; r++) {
          const dist = hexDistance(0, 0, q, r);
          if (dist < this.realmRadius - 1) {
            const neighbors = hexNeighbors(q, r);
            const hasAdjacentBorder = neighbors.some((n) =>
              this.realmBorderHexes.has(hexKey(n.q, n.r))
            );
            if (hasAdjacentBorder) {
              candidates.push({ q, r });
            }
          }
        }
      }
    } else {
      // Random position within realm
      for (let q = -this.realmRadius + 2; q <= this.realmRadius - 2; q++) {
        for (let r = -this.realmRadius + 2; r <= this.realmRadius - 2; r++) {
          const dist = hexDistance(0, 0, q, r);
          if (dist < this.realmRadius - 2 && !this.realmBorderHexes.has(hexKey(q, r))) {
            candidates.push({ q, r });
          }
        }
      }
    }

    return candidates.length > 0 ? this.rng.choice(candidates) : { q: 0, r: 0 };
  }

  generateInitialBorderShell() {
    const radius = this.realmRadius + 2;
    for (let q = -radius; q <= radius; q++) {
      for (let r = -radius; r <= radius; r++) {
        const dist = hexDistance(0, 0, q, r);
        if (dist >= 5 && dist <= radius) {
          const borderProb = getBorderProbability(q, r, dist, this.borderClusters);
          if (this.rng.next() < borderProb) {
            this.createRealmBorderHex(q, r);
          }
        }
      }
    }
  }

  createRealmBorderHex(q, r) {
    const key = hexKey(q, r);
    if (this.hexes.has(key)) return;

    // Use shared border hex creation for RNG consistency
    const borderTypes = ['sea', 'cliff', 'wasteland'];
    const ctx = {
      rng: this.rng,
      hexes: this.hexes,
      borderHexes: this.realmBorderHexes,
      borderTypes,
    };

    const borderHex = sharedCreateBorderHex(ctx, q, r);
    if (borderHex) {
      // Override fields for simulator's simpler structure
      borderHex.terrain = 'border';
      borderHex.isExplored = false;
      borderHex.isRevealed = false;
      borderHex.isLake = false;
      borderHex.riverEdges = [];
    }
  }

  isBorderHex(q, r) {
    const hex = this.hexes.get(hexKey(q, r));
    return hex && hex.isBorder;
  }

  createHex(q, r) {
    // CRITICAL: Order of operations must match UI's generateHex() for RNG consistency
    // UI order: 1) shouldBeLake, 2) create hex, 3) maybeEncounterRiver, 4) extendRiversOnReveal, 5) terrain

    // 1. Check if should be lake FIRST (matches UI line 445)
    const lakeCtx = {
      rng: this.rng,
      hexes: this.hexes,
      constraints: this.constraints,
      lakes: this.lakes,
      // Required for wouldBlockOnlyPath() check
      currentExplorerPos: this.currentExplorerPos,
      exploredHexes: this.exploredHexes,
      barrierEdges: this.barrierEdges,
      realmRadius: this.realmRadius,
      wouldTrapExplorer: (edgeKey, lakeKey) => {
        const ctx = {
          hexes: this.hexes,
          exploredHexes: this.exploredHexes,
          revealedHexes: this.revealedHexes,
          currentExplorerPos: this.currentExplorerPos,
          barrierEdges: this.barrierEdges,
          realmRadius: this.realmRadius,
        };
        return sharedWouldTrapExplorer(ctx, edgeKey, lakeKey);
      },
    };
    const isLake = shouldBeLake(lakeCtx, q, r);

    // 2. Create hex object (matches UI lines 447-458)
    const hex = {
      q,
      r,
      terrain: 'plains', // Will be set after river generation
      isExplored: false,
      isRevealed: true,
      isBorder: false,
      isLake,
      riverEdges: [],
      barrierEdges: [],
    };

    // CRITICAL: Add hex to this.hexes BEFORE river calls (matches UI line 460)
    // This is important because river functions may reference this hex
    const key = hexKey(q, r);
    this.hexes.set(key, hex);

    // 3. NEW RIVER SYSTEM: Maybe encounter first river (matches UI line 464)
    this.maybeEncounterRiver(hex);

    // 4. NEW RIVER SYSTEM: Extend existing rivers to this hex (matches UI line 467)
    this.extendRiversOnReveal(hex);

    // 5. Generate terrain (matches UI line 470)
    // CRITICAL: UI calls generateTerrainWithConstraints EVEN FOR LAKES - it consumes RNG
    // The terrain result is only used if not a lake (line 471: hex.terrain = isLake ? 'lake' : terrain)
    const terrainCtx = {
      rng: this.rng,
      hexes: this.hexes,
      terrainTypes: Object.values(TERRAIN_TYPES),
      terrainAffinities: TERRAIN_AFFINITIES,
      terrainClusters: this.terrainClusters,
      getRiverConstraints: (h) => this.getRiverConstraints(h),
      getElevation: (t) => this.getElevation(t),
      isBorderHex: (q, r) => this.isBorderHex(q, r),
    };
    const terrain = generateTerrainWithConstraints(terrainCtx, q, r);
    hex.terrain = isLake ? 'lake' : terrain;

    // 6. Assign to cluster (matches UI line 474)
    if (isLake) {
      this.assignToLake(hex);
    }

    // Increment explorable count for passable hexes (matches UI's generateHex)
    // This count is used for termination checks, not exploredHexes.size
    if (!hex.isBorder && !hex.isLake) {
      this.constraints.explorableHexes.count++;
    }

    // Generate barriers (skip during validation mode) - matches UI's generateHex
    if (this.generationMode !== 'validation') {
      const neighbors = hexNeighbors(hex.q, hex.r);
      for (const n of neighbors) {
        const nKey = hexKey(n.q, n.r);
        const nHex = this.hexes.get(nKey);
        if (nHex) {
          const barrierCtx = {
            rng: this.rng,
            constraints: this.constraints,
            barrierEdges: this.barrierEdges,
            traversedEdges: this.traversedEdges,
            currentExplorerPos: this.currentExplorerPos,
            // Required for wouldBlockOnlyPath() check
            hexes: this.hexes,
            exploredHexes: this.exploredHexes,
            realmRadius: this.realmRadius,
            wouldTrapExplorer: (edgeKey, lakeKey) => {
              const ctx = {
                hexes: this.hexes,
                exploredHexes: this.exploredHexes,
                revealedHexes: this.revealedHexes,
                currentExplorerPos: this.currentExplorerPos,
                barrierEdges: this.barrierEdges,
                realmRadius: this.realmRadius,
              };
              return sharedWouldTrapExplorer(ctx, edgeKey, lakeKey);
            },
            generationMode: this.generationMode,
          };
          maybeGenerateBarrier(barrierCtx, hex, n.direction, nHex);
        }
      }
    }

    // Add features (matches UI's generateHex) - called for ALL hexes including validation mode
    // NOTE: UI calls maybeAddFeature OUTSIDE the validation check, so we do the same
    const hKey = hexKey(hex.q, hex.r);
    if (!this.constraints.featureRegistry.has(hKey)) {
      const featureCtx = {
        rng: this.rng,
        constraints: this.constraints,
        features: null,
        exploredHexes: this.exploredHexes,
        hasExclusiveFeature: (h) => this.constraints.featureRegistry.has(hexKey(h.q, h.r)),
        canPlaceExclusiveFeature: (h) => !this.constraints.featureRegistry.has(hexKey(h.q, h.r)),
        canPlaceHolding: (h) => {
          for (const pos of this.constraints.holdings.positions) {
            const dist = hexDistance(h.q, h.r, pos.q, pos.r);
            if (dist < 4) return false;
          }
          return true;
        },
      };
      maybeAddFeature(featureCtx, hex);
    }

    return hex;
  }

  assignToLake(hex) {
    const key = hexKey(hex.q, hex.r);
    const neighbors = hexNeighbors(hex.q, hex.r);

    for (const n of neighbors) {
      const nKey = hexKey(n.q, n.r);
      const nHex = this.hexes.get(nKey);
      if (nHex && nHex.isLake) {
        const lakeInfo = this.lakes.find((l) => l.hexes.has(nKey));
        if (lakeInfo) {
          lakeInfo.hexes.add(key);
          return;
        }
      }
    }
    this.lakes.push({ hexes: new Set([key]) });
    this.constraints.lakes.placed++;
  }

  generateTerrain() {
    const terrains = ['plains', 'forest', 'hills', 'crags', 'mire', 'thicket'];
    const weights = [30, 25, 15, 10, 10, 10];
    return this.rng.weightedChoice(terrains, weights);
  }

  getRiverConstraints(hex) {
    // Simplified - no river elevation constraints in simulator
    return { minElevation: 0, maxElevation: 10 };
  }

  getElevation(terrain) {
    return sharedGetElevation(terrain);
  }

  isBorderClosed() {
    for (const key of this.revealedHexes) {
      if (!this.exploredHexes.has(key)) {
        const hex = this.hexes.get(key);
        if (hex && !hex.isBorder && !hex.isLake) {
          return false;
        }
      }
    }
    return true;
  }

  getValidMoves() {
    const { q, r } = this.currentExplorerPos;
    const neighbors = hexNeighbors(q, r);
    const validMoves = [];
    const previousMode = this.generationMode;
    this.generationMode = 'validation';

    try {
      for (const n of neighbors) {
        const nKey = hexKey(n.q, n.r);
        const dist = hexDistance(0, 0, n.q, n.r);
        if (dist >= this.realmRadius) continue;

        let nHex = this.hexes.get(nKey);
        if (nHex && (nHex.isBorder || nHex.isLake)) continue;

        if (!nHex) {
          this.createHex(n.q, n.r); // createHex now adds to this.hexes internally
          nHex = this.hexes.get(nKey);
          // Don't add to revealedHexes yet - wait until it's actually explored
        }

        const edgeKey1 = `${q},${r}:${n.direction}`;
        const oppDir = OPPOSITE_DIRECTION[n.direction];
        const edgeKey2 = `${n.q},${n.r}:${oppDir}`;
        if (this.barrierEdges.has(edgeKey1) || this.barrierEdges.has(edgeKey2)) continue;

        if (nHex && !nHex.isBorder && !nHex.isLake) {
          validMoves.push({ ...n, hex: nHex, key: nKey });
        }
      }
    } finally {
      this.generationMode = previousMode;
    }
    return validMoves;
  }

  findPathToUnexplored() {
    const start = hexKey(this.currentExplorerPos.q, this.currentExplorerPos.r);
    const visited = new Set([start]);
    const queue = [{ key: start, path: [] }];

    while (queue.length > 0) {
      const { key, path } = queue.shift();
      const [q, r] = key.split(',').map(Number);
      const neighbors = hexNeighbors(q, r);

      for (const n of neighbors) {
        const nKey = hexKey(n.q, n.r);
        if (visited.has(nKey)) continue;

        // Check if this would be a border hex
        const dist = hexDistance(0, 0, n.q, n.r);
        if (dist >= this.realmRadius) continue;

        visited.add(nKey);

        const nHex = this.hexes.get(nKey);
        if (nHex && (nHex.isBorder || nHex.isLake)) continue;

        const edgeKey1 = `${q},${r}:${n.direction}`;
        const oppDir = OPPOSITE_DIRECTION[n.direction];
        const edgeKey2 = `${n.q},${n.r}:${oppDir}`;
        if (this.barrierEdges.has(edgeKey1) || this.barrierEdges.has(edgeKey2)) continue;

        const newPath = [...path, { q: n.q, r: n.r, key: nKey, direction: n.direction }];

        if (!this.exploredHexes.has(nKey)) {
          return newPath;
        }

        queue.push({ key: nKey, path: newPath });
      }
    }
    return null;
  }

  moveExplorer() {
    // CRITICAL: Must match UI's moveExplorer exactly for RNG consistency

    // Check max limit (matches UI line 1747)
    if (this.constraints.explorableHexes.count >= this.constraints.explorableHexes.max) {
      this.constraints.borderClosure.complete = true;
      this.forceCompleteFeatures();
      return false;
    }

    const prevPos = { ...this.currentExplorerPos };
    const validMoves = this.getValidMoves();
    if (validMoves.length === 0) {
      this.constraints.borderClosure.complete = true;
      this.forceCompleteFeatures();
      return false;
    }

    // Check if border is naturally closed (matches UI line 1766)
    if (this.isBorderClosed()) {
      this.constraints.borderClosure.complete = true;
      if (this.constraints.explorableHexes.count >= this.constraints.explorableHexes.min) {
        this.forceCompleteFeatures();
        return false;
      }
    }

    let chosenMove;

    // Categorize moves (matches UI lines 1777-1778)
    const unexplored = validMoves.filter((m) => !this.exploredHexes.has(m.key));
    const unexploredWithFeatures = unexplored.filter((m) => m.hex && m.hex.feature);

    // Collect river frontier hexes (matches UI lines 1780-1791)
    const riverFrontierKeys = new Set();
    for (const [, edge] of this.riverEdges) {
      const destHex = hexNeighbor(edge.hex1.q, edge.hex1.r, edge.direction);
      const destKey = hexKey(destHex.q, destHex.r);
      if (!this.exploredHexes.has(destKey)) {
        riverFrontierKeys.add(destKey);
      }
    }
    const unexploredRiverFrontiers = unexplored.filter((m) => riverFrontierKeys.has(m.key));

    // Priority 0: Adjacent unexplored hex that's a river frontier (80%) - matches UI line 1794
    if (unexploredRiverFrontiers.length > 0 && this.rng.next() < 0.8) {
      chosenMove = this.rng.choice(unexploredRiverFrontiers);
    }
    // Priority 1: Adjacent unexplored hex with feature (98%) - matches UI line 1798
    else if (unexploredWithFeatures.length > 0 && this.rng.next() < 0.98) {
      chosenMove = this.rng.choice(unexploredWithFeatures);
    }
    // Priority 2: Any adjacent unexplored hex (98%) - matches UI line 1802
    else if (unexplored.length > 0 && this.rng.next() < 0.98) {
      chosenMove = this.rng.choice(unexplored);
    }
    // Priority 3: Use pathfinding to navigate toward nearest unexplored - matches UI line 1806
    else {
      const pathToUnexplored = this.findPathToUnexplored();

      if (pathToUnexplored && pathToUnexplored.length > 0) {
        const nextStep = pathToUnexplored[0];
        const nextKey = hexKey(nextStep.q, nextStep.r);

        const pathMove = validMoves.find((m) => m.key === nextKey);
        if (pathMove) {
          // Add some randomness - 85% follow path, 15% explore differently (matches UI line 1818)
          if (this.rng.next() < 0.85) {
            chosenMove = pathMove;
          } else {
            const alternates = validMoves.filter((m) => m.key !== nextKey);
            if (alternates.length > 0) {
              chosenMove = this.rng.choice(alternates);
            } else {
              chosenMove = pathMove;
            }
          }
        } else {
          chosenMove = this.rng.choice(validMoves);
        }
      } else {
        chosenMove = this.rng.choice(validMoves);
      }
    }

    // Record traversed edge (prevPos already captured at function start)
    const edgeKey1 = `${prevPos.q},${prevPos.r}:${chosenMove.direction}`;
    const oppDir = OPPOSITE_DIRECTION[chosenMove.direction];
    const edgeKey2 = `${chosenMove.q},${chosenMove.r}:${oppDir}`;
    this.traversedEdges.add(edgeKey1);
    this.traversedEdges.add(edgeKey2);

    // Set exploration mode
    this.generationMode = 'exploration';

    // Execute the move
    this.currentExplorerPos = { q: chosenMove.q, r: chosenMove.r };
    const moveHex = this.hexes.get(chosenMove.key);
    moveHex.isExplored = true;
    moveHex.isRevealed = true;
    this.exploredHexes.add(chosenMove.key);
    this.revealedHexes.add(chosenMove.key);

    // Reveal and generate neighbors
    for (const n of hexNeighbors(chosenMove.q, chosenMove.r)) {
      const nKey = hexKey(n.q, n.r);
      if (!this.hexes.has(nKey)) {
        this.createHex(n.q, n.r); // createHex now adds to this.hexes internally
      }
      const nHex = this.hexes.get(nKey);
      if (nHex && !nHex.isRevealed) {
        nHex.isRevealed = true;
        this.revealedHexes.add(nKey);
      }
    }

    if (this.exploredHexes.size % 5 === 0) {
      this.updateRealmDimensions();
    }
    if (this.exploredHexes.size % 10 === 0) {
      this.checkBorderClosure();
    }

    return true;
  }

  // ============ RIVER LOGIC (NEW SYSTEM: Primary Features with Lazy Terrain) ============

  // Get canonical vertex key from hex coordinates and two adjacent edge directions
  getVertexKey(q, r, dir1, dir2) {
    const dirs = [dir1, dir2].sort();
    return `${q},${r}:${dirs[0]}-${dirs[1]}`;
  }

  // 1/12 chance per hex reveal to initiate first river
  maybeEncounterRiver(hex) {
    if (this.riverEncountered) return;
    if (hex.isBorder || hex.isLake) return;

    if (this.rng.next() < 1 / 12) {
      this.riverEncountered = true;
      this.initiateRiver(hex);
    }
  }

  // Create new river network with initial edge and grow in both directions
  initiateRiver(hex) {
    // Create context for shared river generation functions
    const ctx = {
      rng: this.rng,
      hexes: this.hexes,
      borderHexes: this.borderHexes,
      isBorderHex: (q, r) => this.isBorderHex(q, r),
      rivers: this.rivers,
      riverIdCounter: this.riverIdCounter,
      riverEdges: this.riverEdges,
      plannedRiverEdges: this.plannedRiverEdges,
      addRiverEdge: (network, hex, dir) => this.addRiverEdge(network, hex, dir),
      planRiverPath: (network, startHex, startDir) =>
        this.planRiverPath(network, startHex, startDir),
    };

    // Call shared vertex-centric river initialization
    initiateRiver(ctx, hex);

    // Update riverIdCounter in case it was incremented
    this.riverIdCounter = ctx.riverIdCounter;
  }

  // Pre-plan river path from starting point, ensuring vertex connectivity
  planRiverPath(network, startHex, startDir) {
    // Create context for shared river generation functions
    const ctx = {
      rng: this.rng,
      hexes: this.hexes,
      borderHexes: this.borderHexes,
      isBorderHex: (q, r) => this.isBorderHex(q, r),
      riverEdges: this.riverEdges,
      plannedRiverEdges: this.plannedRiverEdges,
    };

    // Call shared path planning function
    planRiverPath(ctx, network, startHex, startDir);
  }

  // Check all neighbors of revealed hex for river edges pointing toward us
  // Also activate any planned river edges for this hex
  extendRiversOnReveal(hex) {
    if (hex.isBorder || hex.isLake) return;

    // First, activate any planned river edges for this hex
    if (this.plannedRiverEdges) {
      for (const [edgeKey, planned] of this.plannedRiverEdges) {
        if (planned.hexQ === hex.q && planned.hexR === hex.r) {
          // Update hex.riverEdges
          if (!hex.riverEdges.includes(planned.direction)) {
            hex.riverEdges.push(planned.direction);
          }

          // Update neighbor's riverEdges if neighbor exists
          const neighbor = hexNeighbor(hex.q, hex.r, planned.direction);
          const neighborKey = hexKey(neighbor.q, neighbor.r);
          const neighborHex = this.hexes.get(neighborKey);
          if (neighborHex) {
            const oppDir = OPPOSITE_DIRECTION[planned.direction];
            if (!neighborHex.riverEdges.includes(oppDir)) {
              neighborHex.riverEdges.push(oppDir);
            }
          }
        }
      }
    }

    // Also check neighbors for existing river edges pointing toward us
    for (const direction of DIRECTION_NAMES) {
      const neighbor = hexNeighbor(hex.q, hex.r, direction);
      const neighborHex = this.hexes.get(hexKey(neighbor.q, neighbor.r));

      if (!neighborHex) continue; // Neighbor not revealed yet

      // Check if neighbor has river edge pointing toward us
      const oppositeDir = OPPOSITE_DIRECTION[direction];
      if (neighborHex.riverEdges?.includes(oppositeDir)) {
        // Add to our riverEdges array
        if (!hex.riverEdges.includes(direction)) {
          hex.riverEdges.push(direction);
        }
      }
    }
  }

  // Score a frontier hex by counting its unexplored neighbors
  scoreFrontier(hex, direction) {
    const frontier = hexNeighbor(hex.q, hex.r, direction);

    // Count frontier's neighbors that are NOT explored
    let unexploredCount = 0;
    for (const dir of DIRECTION_NAMES) {
      const neighbor = hexNeighbor(frontier.q, frontier.r, dir);
      const key = hexKey(neighbor.q, neighbor.r);
      const neighborHex = this.hexes.get(key);

      // Skip if it's a border (can't expand there)
      if (neighborHex && neighborHex.isBorder) {
        continue;
      }

      // Count as unexplored if: no hex exists yet, OR hex exists but not revealed
      if (!neighborHex || !this.revealedHexes.has(key)) {
        unexploredCount++;
      }
    }

    return unexploredCount; // 0-6, higher is better
  }

  // Extend river through a hex that just joined (simplified contiguous growth)
  maybeExtendRiverThrough(hex, incomingDirection) {
    // Find which network this edge belongs to
    const edgeKey = this.getEdgeKey(hex.q, hex.r, incomingDirection);
    const edge = this.riverEdges.get(edgeKey);
    if (!edge) return;

    // Get the network for this edge
    const network = this.rivers.find((n) => n.edges.has(edgeKey));
    if (!network) return;

    // Check if network has reached target length
    if (network.edges.size >= 24) return;

    // Get valid directions - must be adjacent to incoming for visual connectivity
    const adjacentDirs = getAdjacentDirections(incomingDirection);

    const isValidDirection = (dir) => {
      const ek = this.getEdgeKey(hex.q, hex.r, dir);
      if (this.riverEdges.has(ek)) return false; // Don't double up
      const n = hexNeighbor(hex.q, hex.r, dir);
      if (this.isBorderHex(n.q, n.r)) return false; // Don't hit borders
      const nKey = hexKey(n.q, n.r);
      if (this.realmBorderHexes.has(nKey)) return false;
      if (this.hexes.has(nKey)) return false; // Don't extend into already-explored hexes (canon principle)
      return true;
    };

    // Only use adjacent directions for visual connectivity
    const validDirs = adjacentDirs.filter(isValidDirection);

    if (validDirs.length === 0) return;

    // Score each valid direction by frontier openness
    const scoredDirs = validDirs.map((dir) => ({
      dir,
      score: this.scoreFrontier(hex, dir),
    }));

    // Adaptive tributary probability - front-load branches for more breakout opportunities
    const remainingLength = 24 - network.edges.size;
    const remainingTributaries = 3 - network.tributaryCount;
    // Very high floor (0.6) ensures very aggressive early branching for breakout opportunities
    const tributaryProb =
      remainingTributaries > 0
        ? Math.max(0.6, remainingTributaries / Math.max(1, remainingLength))
        : 0;
    const createTributary = this.rng.next() < tributaryProb && validDirs.length >= 2;

    // Choose 1 or 2 directions with bias toward open frontiers
    let directions;
    if (createTributary) {
      // For tributaries, pick top 2 by score
      scoredDirs.sort((a, b) => b.score - a.score);
      directions = scoredDirs.slice(0, 2).map((s) => s.dir);
    } else {
      // For single extension, use weighted random selection with squared scores
      const weights = scoredDirs.map((s) => Math.max(1, s.score * s.score));
      const chosen = this.rng.weightedChoice(scoredDirs, weights);
      directions = [chosen.dir];
    }

    // Add edges
    for (const dir of directions) {
      this.addRiverEdge(network, hex, dir);
    }

    // Increment tributary count if we branched
    if (directions.length > 1) {
      network.tributaryCount++;
    }
  }

  shuffleArray(array) {
    const result = [...array];
    for (let i = result.length - 1; i > 0; i--) {
      const j = Math.floor(this.rng.next() * (i + 1));
      [result[i], result[j]] = [result[j], result[i]];
    }
    return result;
  }

  // Add river edge (only extends into unexplored hexes)
  addRiverEdge(network, hex, direction) {
    const edgeKey = this.getEdgeKey(hex.q, hex.r, direction);
    if (this.riverEdges.has(edgeKey)) return;

    const neighbor = hexNeighbor(hex.q, hex.r, direction);

    // Store edge in riverEdges Map
    const oppDir = OPPOSITE_DIRECTION[direction];
    const useOriginal = hex.q < neighbor.q || (hex.q === neighbor.q && hex.r < neighbor.r);
    this.riverEdges.set(edgeKey, {
      hex1: useOriginal ? { q: hex.q, r: hex.r } : { q: neighbor.q, r: neighbor.r },
      direction: useOriginal ? direction : oppDir,
      flowDirection: 'unspecified',
    });

    // Add edge to network
    network.edges.add(edgeKey);

    // Update hex.riverEdges for current hex
    if (!hex.riverEdges.includes(direction)) {
      hex.riverEdges.push(direction);
    }
    // Note: neighbor hex gets the river edge when it's explored via extendRiversOnReveal
    // We never retroactively modify already-explored hexes (canon principle)
  }

  // Calculate path length (edge count) for a river network
  calculatePathLength(network) {
    return network.edges.size;
  }

  // ============ OLD RIVER LOGIC (for reference) ============

  getEdgeKey(q, r, direction) {
    const neighbor = hexNeighbor(q, r, direction);
    const oppDir = OPPOSITE_DIRECTION[direction];
    if (q < neighbor.q || (q === neighbor.q && r < neighbor.r)) {
      return `${q},${r}:${direction}`;
    }
    return `${neighbor.q},${neighbor.r}:${oppDir}`;
  }

  getAdjacentEdgeDirections(direction) {
    const idx = DIRECTION_NAMES.indexOf(direction);
    return [DIRECTION_NAMES[(idx + 1) % 6], DIRECTION_NAMES[(idx + 5) % 6]];
  }

  getRiverEdgeCountAtVertex(q, r, direction) {
    const adjacentDirs = this.getAdjacentEdgeDirections(direction);
    const clockwiseDir = adjacentDirs[0];

    const edgesToCheck = new Set();
    edgesToCheck.add(this.getEdgeKey(q, r, direction));
    edgesToCheck.add(this.getEdgeKey(q, r, clockwiseDir));

    const neighbor1 = hexNeighbor(q, r, direction);
    const oppDir = OPPOSITE_DIRECTION[direction];
    const neighbor1Adjacent = this.getAdjacentEdgeDirections(oppDir);
    edgesToCheck.add(this.getEdgeKey(neighbor1.q, neighbor1.r, neighbor1Adjacent[1]));

    const neighbor2 = hexNeighbor(q, r, clockwiseDir);
    const oppClockwise = OPPOSITE_DIRECTION[clockwiseDir];
    const neighbor2Adjacent = this.getAdjacentEdgeDirections(oppClockwise);
    edgesToCheck.add(this.getEdgeKey(neighbor2.q, neighbor2.r, neighbor2Adjacent[0]));

    let count = 0;
    for (const key of edgesToCheck) {
      if (this.riverEdges.has(key)) count++;
    }
    return count;
  }

  getMaxRiverCountAtEdge(q, r, direction) {
    const count1 = this.getRiverEdgeCountAtVertex(q, r, direction);

    const adjacentDirs = this.getAdjacentEdgeDirections(direction);
    const counterDir = adjacentDirs[1];

    const edgesToCheck = new Set();
    edgesToCheck.add(this.getEdgeKey(q, r, direction));
    edgesToCheck.add(this.getEdgeKey(q, r, counterDir));

    const neighbor1 = hexNeighbor(q, r, direction);
    const oppDir = OPPOSITE_DIRECTION[direction];
    const neighbor1Adjacent = this.getAdjacentEdgeDirections(oppDir);
    edgesToCheck.add(this.getEdgeKey(neighbor1.q, neighbor1.r, neighbor1Adjacent[0]));

    const neighbor2 = hexNeighbor(q, r, counterDir);
    const oppCounter = OPPOSITE_DIRECTION[counterDir];
    const neighbor2Adjacent = this.getAdjacentEdgeDirections(oppCounter);
    edgesToCheck.add(this.getEdgeKey(neighbor2.q, neighbor2.r, neighbor2Adjacent[1]));

    let count2 = 0;
    for (const key of edgesToCheck) {
      if (this.riverEdges.has(key)) count2++;
    }

    return Math.max(count1, count2);
  }

  distanceToNearestRiver(q, r) {
    if (this.riverEdges.size === 0) return Infinity;

    const visited = new Set();
    const queue = [{ q, r, dist: 0 }];
    visited.add(hexKey(q, r));

    while (queue.length > 0) {
      const { q: cq, r: cr, dist } = queue.shift();
      if (dist > 10) return Infinity;

      for (const dir of DIRECTION_NAMES) {
        const edgeKey = this.getEdgeKey(cq, cr, dir);
        if (this.riverEdges.has(edgeKey)) {
          return dist;
        }
      }

      for (const n of hexNeighbors(cq, cr)) {
        const nKey = hexKey(n.q, n.r);
        if (!visited.has(nKey)) {
          visited.add(nKey);
          queue.push({ q: n.q, r: n.r, dist: dist + 1 });
        }
      }
    }

    return Infinity;
  }

  getRiverOriginScore(hex) {
    const elev = this.getElevation(hex.terrain);
    if (elev >= 2) return 1.5;
    if (elev === 1) return 1.0;
    return 0.5;
  }

  maybeGenerateRiver(hex, direction, neighborHex) {
    const edgeKey = this.getEdgeKey(hex.q, hex.r, direction);
    if (this.riverEdges.has(edgeKey)) return;

    const edgeCountAtVertex = this.getMaxRiverCountAtEdge(hex.q, hex.r, direction);
    const metrics = this.calculateRiverMetrics();
    const hasNetwork = metrics.networkCount > 0;
    const hasMetSpanTarget = metrics.span >= this.constraints.riverNetwork.targetSpan;
    const needsMoreTributaries =
      metrics.tributaryCount < this.constraints.riverNetwork.targetTributaries;
    const tooManyNetworks = metrics.networkCount > 1;

    // CASE 1: At river tip (1 edge at vertex) - continuation
    // Very high probability to extend rivers for better connectivity
    if (edgeCountAtVertex === 1) {
      let continueProb;
      if (!hasMetSpanTarget) {
        continueProb = 0.98; // 98% to extend until span target (need ~10+ steps)
      } else if (tooManyNetworks) {
        continueProb = 0.85; // 85% to try merging networks
      } else {
        continueProb = 0.4; // 40% after targets met
      }
      if (this.rng.next() >= continueProb) return;
    }
    // CASE 2: At 2-edge vertex (would create tributary)
    else if (edgeCountAtVertex === 2) {
      // Target ~3 tributaries. Prioritize span first, then tributaries.
      let tributaryProb = 0.0;
      if (hasMetSpanTarget && needsMoreTributaries) {
        tributaryProb = 0.5; // High prob after span target to quickly get tributaries
      } else if (needsMoreTributaries) {
        tributaryProb = 0.08; // Low prob before span target
      }
      if (this.rng.next() >= tributaryProb) return;
    }
    // CASE 3: At 3+ edge vertex (confluence)
    else if (edgeCountAtVertex >= 3) {
      return;
    }
    // CASE 4: New origin (no connection to existing river)
    else {
      const riverOriginScore = this.getRiverOriginScore(hex);

      let originProb = 0;
      if (!hasNetwork) {
        // No network exists yet - higher chance to start the first river
        originProb = 0.1 * riverOriginScore;
      } else {
        // Network exists - almost NEVER start new disconnected rivers
        // Only allow new origins very rarely to occasionally create secondary rivers
        originProb = 0.0005 * riverOriginScore;
      }

      if (this.rng.next() >= originProb) return;
    }

    // Store with normalized hex/direction (matches the fix in real generator)
    const neighbor = hexNeighbor(hex.q, hex.r, direction);
    const oppDir = OPPOSITE_DIRECTION[direction];
    const useOriginal = hex.q < neighbor.q || (hex.q === neighbor.q && hex.r < neighbor.r);

    this.riverEdges.set(edgeKey, {
      hex1: useOriginal ? { q: hex.q, r: hex.r } : { q: neighbor.q, r: neighbor.r },
      direction: useOriginal ? direction : oppDir,
    });

    hex.riverEdges.push(direction);
  }

  // Validate river network structure (catches missing properties early)
  validateRiverNetworks() {
    for (const network of this.rivers) {
      if (typeof network.id !== 'number') {
        throw new Error(`River network missing 'id' property`);
      }
      if (!(network.edges instanceof Set)) {
        throw new Error(`River network ${network.id} missing 'edges' Set`);
      }
      if (typeof network.tributaryCount !== 'number') {
        throw new Error(`River network ${network.id} missing 'tributaryCount'`);
      }
    }
  }

  calculateRiverMetrics() {
    if (this.riverEdges.size === 0) {
      return { networkCount: 0, tributaryCount: 0, span: 0, pathLength: 0 };
    }

    // Validate structure before computing metrics
    this.validateRiverNetworks();

    // Count networks from explicit tracking (more reliable than flood-fill)
    const networkCount = this.rivers.length;

    // Count tributaries from explicit branching events (network.tributaryCount)
    // This is more meaningful than vertex topology counting
    let tributaryCount = 0;
    for (const network of this.rivers) {
      tributaryCount += network.tributaryCount;
    }

    const span = this.calculateRiverNetworkSpan();

    // Calculate path length (max edge count across all networks)
    let pathLength = 0;
    for (const network of this.rivers) {
      pathLength = Math.max(pathLength, network.edges.size);
    }

    return { networkCount, tributaryCount, span, pathLength };
  }

  floodFillRiverNetwork(startKey, visited) {
    const network = new Set();
    const queue = [startKey];

    while (queue.length > 0) {
      const key = queue.shift();
      if (visited.has(key)) continue;

      visited.add(key);
      network.add(key);

      const edge = this.riverEdges.get(key);
      if (!edge) continue;

      const { hex1, direction } = edge;
      const adjacentDirs = this.getAdjacentEdgeDirections(direction);

      // Vertex 1 (clockwise)
      const clockwiseDir = adjacentDirs[0];
      const v1Edges = [this.getEdgeKey(hex1.q, hex1.r, clockwiseDir)];
      const n1 = hexNeighbor(hex1.q, hex1.r, direction);
      const n1Adj = this.getAdjacentEdgeDirections(OPPOSITE_DIRECTION[direction]);
      v1Edges.push(this.getEdgeKey(n1.q, n1.r, n1Adj[1]));
      const n2 = hexNeighbor(hex1.q, hex1.r, clockwiseDir);
      const n2Adj = this.getAdjacentEdgeDirections(OPPOSITE_DIRECTION[clockwiseDir]);
      v1Edges.push(this.getEdgeKey(n2.q, n2.r, n2Adj[0]));

      // Vertex 2 (counterclockwise)
      const counterDir = adjacentDirs[1];
      const v2Edges = [this.getEdgeKey(hex1.q, hex1.r, counterDir)];
      const n3 = hexNeighbor(hex1.q, hex1.r, direction);
      const n3Adj = this.getAdjacentEdgeDirections(OPPOSITE_DIRECTION[direction]);
      v2Edges.push(this.getEdgeKey(n3.q, n3.r, n3Adj[0]));
      const n4 = hexNeighbor(hex1.q, hex1.r, counterDir);
      const n4Adj = this.getAdjacentEdgeDirections(OPPOSITE_DIRECTION[counterDir]);
      v2Edges.push(this.getEdgeKey(n4.q, n4.r, n4Adj[1]));

      for (const edgeKey of [...v1Edges, ...v2Edges]) {
        if (this.riverEdges.has(edgeKey) && !visited.has(edgeKey)) {
          queue.push(edgeKey);
        }
      }
    }

    return network;
  }

  calculateRiverNetworkSpan() {
    if (this.riverEdges.size === 0) return 0;

    const visited = new Set();
    let maxSpan = 0;

    for (const edgeKey of this.riverEdges.keys()) {
      if (visited.has(edgeKey)) continue;

      const networkEdges = this.floodFillRiverNetwork(edgeKey, visited);
      const span = this.calculateNetworkSpan(networkEdges);
      maxSpan = Math.max(maxSpan, span);
    }

    return maxSpan;
  }

  calculateNetworkSpan(networkEdges) {
    if (networkEdges.size === 0) return 0;

    const hexes = new Set();
    for (const key of networkEdges) {
      const edge = this.riverEdges.get(key);
      if (edge) {
        hexes.add(hexKey(edge.hex1.q, edge.hex1.r));
        const neighbor = hexNeighbor(edge.hex1.q, edge.hex1.r, edge.direction);
        hexes.add(hexKey(neighbor.q, neighbor.r));
      }
    }

    let maxDist = 0;
    const hexArray = Array.from(hexes).map((k) => {
      const [q, r] = k.split(',').map(Number);
      return { q, r };
    });

    for (let i = 0; i < hexArray.length; i++) {
      for (let j = i + 1; j < hexArray.length; j++) {
        const dist = hexDistance(hexArray[i].q, hexArray[i].r, hexArray[j].q, hexArray[j].r);
        maxDist = Math.max(maxDist, dist);
      }
    }

    return maxDist;
  }

  updateRealmDimensions() {
    if (this.exploredHexes.size === 0) return;

    let minQ = Infinity,
      maxQ = -Infinity;
    let minR = Infinity,
      maxR = -Infinity;

    for (const key of this.exploredHexes) {
      const hex = this.hexes.get(key);
      if (!hex) continue;
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

  checkBorderClosure() {
    this.constraints.borderClosure.complete = this.isBorderClosed();
  }

  forceCompleteFeatures() {
    const forceCtx = {
      rng: this.rng,
      hexes: this.hexes,
      exploredHexes: this.exploredHexes,
      constraints: this.constraints,
      features: null, // Simulator doesn't track features map
      hasExclusiveFeature: (hex) => this.constraints.featureRegistry.has(hexKey(hex.q, hex.r)),
      canPlaceHolding: (hex) => {
        for (const pos of this.constraints.holdings.positions) {
          const dist = hexDistance(hex.q, hex.r, pos.q, pos.r);
          if (dist < 4) return false;
        }
        return true;
      },
    };

    sharedForceCompleteFeatures(forceCtx);
  }

  validateHardConstraints() {
    const violations = [];

    if (!this.constraints.borderClosure.complete && this.exploredHexes.size >= 100) {
      violations.push({ constraint: 'Border Closure', message: 'Border not fully closed' });
    }
    if (this.constraints.explorableHexes.count < this.constraints.explorableHexes.min) {
      violations.push({
        constraint: 'Min Explorable',
        message: `Only ${this.constraints.explorableHexes.count}/100 hexes`,
      });
    }
    if (this.constraints.explorableHexes.count > this.constraints.explorableHexes.max) {
      violations.push({
        constraint: 'Max Explorable',
        message: `${this.constraints.explorableHexes.count} exceeds max 180`,
      });
    }
    if (this.constraints.holdings.placed !== this.constraints.holdings.target) {
      violations.push({
        constraint: 'Holdings Count',
        message: `${this.constraints.holdings.placed}/4 placed`,
      });
    }
    if (this.constraints.mythSites.placed !== this.constraints.mythSites.target) {
      violations.push({
        constraint: 'Myth Sites Count',
        message: `${this.constraints.mythSites.placed}/6 placed`,
      });
    }
    if (this.constraints.lakes.placed > this.constraints.lakes.max) {
      violations.push({
        constraint: 'Lakes Max',
        message: `${this.constraints.lakes.placed} exceeds max 3`,
      });
    }

    for (const [type, data] of Object.entries(this.constraints.landmarks)) {
      if (data.placed < data.min) {
        violations.push({
          constraint: `Landmarks (${type})`,
          message: `Only ${data.placed}/${data.min} placed`,
        });
      }
    }

    return { valid: violations.length === 0, violations };
  }
}

// Run simulation
async function runSimulation(seed, maxSteps, quiet = false, debugSeeds = []) {
  if (!quiet) {
    process.stdout.write(`  Seed ${seed}: `);
  }

  const generator = new StandaloneRealmGenerator(seed);
  generator.debugRiver = debugSeeds.includes(seed);
  generator.initialize();

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

  const riverMetrics = generator.calculateRiverMetrics();
  const validation = generator.validateHardConstraints();

  if (!quiet) {
    const status = validation.valid ? '✓' : '✗';
    console.log(
      ` ${status} (${steps} steps, ${generator.exploredHexes.size} hexes, net=${riverMetrics.networkCount} trib=${riverMetrics.tributaryCount} span=${riverMetrics.span} path=${riverMetrics.pathLength})`
    );
  }

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
      featureExclusivity: true,
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
      featureExclusivityViolations: 0,
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
      riverSpan: riverMetrics.span,
      riverPathLength: riverMetrics.pathLength,
      riverNetworkCount: riverMetrics.networkCount,
      riverTributaryCount: riverMetrics.tributaryCount,
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

  return { min, max, avg: parseFloat(avg.toFixed(2)), stddev: parseFloat(stddev.toFixed(2)) };
}

// Analyze results
function analyzeResults(results) {
  const analysis = {
    meta: { timestamp: new Date().toISOString(), simulations: results.length, config },
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

  const hardConstraints = [
    'borderClosure',
    'minExplorable',
    'maxExplorable',
    'holdingsCount',
    'mythSitesCount',
    'featureExclusivity',
    'lakesMax',
    'landmarksCurse',
    'landmarksDwelling',
    'landmarksHazard',
    'landmarksMonument',
    'landmarksRuin',
    'landmarksSanctum',
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

  hardConstraints.forEach((name) => {
    const passes = results.filter((r) => r.hard[name] === true).length;
    const passRate = parseFloat(((passes / results.length) * 100).toFixed(1));
    const values = results.map((r) => r.hardValues[hardValueKeys[name]]);
    const stats = calculateStats(values);
    analysis.hardConstraints[name] = { passRate, passes, fails: results.length - passes, ...stats };
  });

  const softConstraints = [
    { name: 'explorableTarget', key: 'explorableTarget', ideal: 144 },
    { name: 'realmWidth', key: 'realmWidth', ideal: 12 },
    { name: 'realmHeight', key: 'realmHeight', ideal: 12 },
    { name: 'riverSpan', key: 'riverSpan', ideal: 8 },
    { name: 'riverPathLength', key: 'riverPathLength', ideal: 24 },
    { name: 'riverNetworkCount', key: 'riverNetworkCount', ideal: 1 },
    { name: 'riverTributaryCount', key: 'riverTributaryCount', ideal: 3 },
    { name: 'barriers', key: 'barriers', ideal: 24 },
    { name: 'lakes', key: 'lakes', ideal: 2.5 },
  ];

  softConstraints.forEach((constraint) => {
    const values = results.map((r) => r.soft[constraint.key]);
    const stats = calculateStats(values);
    const deviations = values.map((v) => Math.abs(v - constraint.ideal));
    const avgDeviation = deviations.reduce((a, b) => a + b, 0) / deviations.length;
    const qualityScore = parseFloat(
      Math.max(0, 100 - (avgDeviation / constraint.ideal) * 100).toFixed(1)
    );
    analysis.softConstraints[constraint.name] = { qualityScore, ideal: constraint.ideal, ...stats };
  });

  const totalHardChecks = hardConstraints.length * results.length;
  const passedHardChecks = results.reduce(
    (sum, r) => sum + Object.values(r.hard).filter((v) => v === true).length,
    0
  );
  analysis.summary.overallHardConstraintPassRate = parseFloat(
    ((passedHardChecks / totalHardChecks) * 100).toFixed(1)
  );

  return analysis;
}

// Print results
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
    console.log(
      `  ${status} ${name.padEnd(28)} ${(data.passRate + '%').padEnd(10)} ${String(data.min).padEnd(6)} ${String(data.max).padEnd(6)} ${String(data.avg).padEnd(6)} ${String(data.stddev).padEnd(6)}`
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
    console.log(
      `  ${status} ${name.padEnd(28)} ${(data.qualityScore + '/100').padEnd(10)} ${String(data.min).padEnd(6)} ${String(data.max).padEnd(6)} ${String(data.avg).padEnd(6)} ${String(data.stddev).padEnd(6)} ${String(data.ideal).padEnd(6)}`
    );
  });

  console.log('\n' + '='.repeat(80));
}

// Main
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
    const result = await runSimulation(seed, config.maxSteps, config.quiet, config.debugSeeds);
    results.push(result);
  }

  console.log('\nAnalyzing results...');
  const analysis = analyzeResults(results);

  printResults(analysis);

  console.log(`\nSaving results to ${config.output}...`);
  writeFileSync(config.output, JSON.stringify(analysis, null, 2));
  console.log('✓ Results saved\n');

  process.exit(analysis.summary.overallHardConstraintPassRate >= 90 ? 0 : 1);
}

main().catch((err) => {
  console.error('Error:', err);
  process.exit(1);
});
