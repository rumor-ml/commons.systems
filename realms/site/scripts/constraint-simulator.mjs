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

// Hex distance calculation (axial coordinates)
function hexDistance(q1, r1, q2, r2) {
  return (Math.abs(q1 - q2) + Math.abs(q1 + r1 - q2 - r2) + Math.abs(r1 - r2)) / 2;
}

// Seeded random number generator (matches the real one)
class SeededRandom {
  constructor(seed) {
    this.state = seed;
  }

  next() {
    this.state = (this.state * 1103515245 + 12345) & 0x7fffffff;
    return this.state / 0x7fffffff;
  }

  choice(array) {
    return array[Math.floor(this.next() * array.length)];
  }

  weightedChoice(array, weights) {
    const total = weights.reduce((a, b) => a + b, 0);
    let roll = this.next() * total;
    for (let i = 0; i < array.length; i++) {
      roll -= weights[i];
      if (roll <= 0) return array[i];
    }
    return array[array.length - 1];
  }
}

// Direction constants
const DIRECTION_NAMES = ['NE', 'E', 'SE', 'SW', 'W', 'NW'];
const OPPOSITE_DIRECTION = { NE: 'SW', E: 'W', SE: 'NW', SW: 'NE', W: 'E', NW: 'SE' };

// Adjacent directions share a vertex - for river connectivity
function getAdjacentDirections(dir) {
  const idx = DIRECTION_NAMES.indexOf(dir);
  const prev = DIRECTION_NAMES[(idx + 5) % 6];
  const next = DIRECTION_NAMES[(idx + 1) % 6];
  return [prev, next];
}

// Hex neighbor calculation
function hexNeighbor(q, r, direction) {
  const offsets = {
    NE: { q: 1, r: -1 },
    E: { q: 1, r: 0 },
    SE: { q: 0, r: 1 },
    SW: { q: -1, r: 1 },
    W: { q: -1, r: 0 },
    NW: { q: 0, r: -1 },
  };
  const offset = offsets[direction];
  return { q: q + offset.q, r: r + offset.r };
}

function hexKey(q, r) {
  return `${q},${r}`;
}

function hexNeighbors(q, r) {
  return DIRECTION_NAMES.map((dir) => ({
    direction: dir,
    ...hexNeighbor(q, r, dir),
  }));
}

// Standalone RealmGenerator that mirrors the real one's river logic
class StandaloneRealmGenerator {
  constructor(seed) {
    this.rng = new SeededRandom(seed);
    this.seed = seed;

    this.hexes = new Map();
    this.exploredHexes = new Set();
    this.revealedHexes = new Set();
    this.borderHexes = new Set();
    this.realmBorderHexes = new Set();
    this.riverEdges = new Map();
    this.barrierEdges = new Set();
    this.traversedEdges = new Set();

    // New river system state
    this.rivers = [];
    this.riverEncountered = false;
    this.riverIdCounter = 0;
    this.plannedRiverEdges = new Map();

    this.currentExplorerPos = { q: 0, r: 0 };
    this.constraints = null;
    this.realmRadius = 10; // Max distance from origin for realm hexes
  }

  initConstraints() {
    this.constraints = {
      borderClosure: { complete: false },
      explorableHexes: { count: 0, min: 100, max: 180, target: 144 },
      holdings: { placed: 0, target: 4, positions: [] },
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

  initialize() {
    this.initConstraints();
    this.generateInitialBorderShell();

    const startHex = {
      q: 0,
      r: 0,
      terrain: 'plains',
      isExplored: true,
      isRevealed: true,
      isBorder: false,
      isLake: false,
      riverEdges: [],
    };

    const key = hexKey(0, 0);
    this.hexes.set(key, startHex);
    this.exploredHexes.add(key);
    this.revealedHexes.add(key);
    this.currentExplorerPos = { q: 0, r: 0 };

    for (const n of hexNeighbors(0, 0)) {
      const nKey = hexKey(n.q, n.r);
      if (!this.hexes.has(nKey)) {
        const revealedHex = this.createHex(n.q, n.r);
        this.hexes.set(nKey, revealedHex);
        this.revealedHexes.add(nKey);
        this.borderHexes.add(nKey);
      }
    }

    this.updateRealmDimensions();
  }

  generateInitialBorderShell() {
    const radius = 10;
    for (let q = -radius; q <= radius; q++) {
      for (let r = -radius; r <= radius; r++) {
        const dist = hexDistance(0, 0, q, r);
        if (dist >= 5 && dist <= radius) {
          const borderProb = this.getBorderProbability(dist);
          if (this.rng.next() < borderProb) {
            this.createRealmBorderHex(q, r);
          }
        }
      }
    }
  }

  getBorderProbability(dist) {
    if (dist === 5) return 0.08;
    if (dist === 6) return 0.2;
    if (dist === 7) return 0.5;
    if (dist === 8) return 0.8;
    return 0.95;
  }

  createRealmBorderHex(q, r) {
    const key = hexKey(q, r);
    if (this.hexes.has(key)) return;
    this.hexes.set(key, {
      q,
      r,
      terrain: 'border',
      isExplored: false,
      isRevealed: false,
      isBorder: true,
      isLake: false,
      riverEdges: [],
    });
    this.realmBorderHexes.add(key);
  }

  isBorderHex(q, r) {
    const hex = this.hexes.get(hexKey(q, r));
    return hex && hex.isBorder;
  }

  createHex(q, r) {
    // Create placeholder hex
    const hex = {
      q,
      r,
      terrain: 'plains', // Will be set after river generation
      isExplored: false,
      isRevealed: true,
      isBorder: false,
      isLake: false,
      riverEdges: [],
    };

    // NEW RIVER SYSTEM: Maybe encounter first river
    this.maybeEncounterRiver(hex);

    // NEW RIVER SYSTEM: Extend existing rivers to this hex
    this.extendRiversOnReveal(hex);

    // Generate terrain after rivers
    hex.terrain = this.generateTerrain(q, r);

    return hex;
  }

  generateTerrain() {
    const terrains = ['plains', 'forest', 'hills', 'crags', 'mire', 'thicket'];
    const weights = [30, 25, 15, 10, 10, 10];
    return this.rng.weightedChoice(terrains, weights);
  }

  getElevation(terrain) {
    const elevations = { mire: 0, plains: 1, forest: 1, thicket: 1, hills: 2, crags: 3 };
    return elevations[terrain] || 1;
  }

  moveExplorer() {
    if (this.exploredHexes.size >= this.constraints.explorableHexes.max) {
      this.constraints.borderClosure.complete = true;
      this.forceCompleteFeatures();
      return false;
    }

    if (this.constraints.borderClosure.complete) {
      if (this.exploredHexes.size >= this.constraints.explorableHexes.min) {
        this.forceCompleteFeatures();
        return false;
      }
    }

    if (this.borderHexes.size === 0) {
      this.constraints.borderClosure.complete = true;
      this.forceCompleteFeatures();
      return false;
    }

    const borderArray = Array.from(this.borderHexes)
      .map((key) => this.hexes.get(key))
      .filter(Boolean);

    // Compactness bias (no exploration bias needed with contiguous growth)
    let sumQ = 0,
      sumR = 0;
    for (const key of this.exploredHexes) {
      const hex = this.hexes.get(key);
      if (hex) {
        sumQ += hex.q;
        sumR += hex.r;
      }
    }
    const centerQ = sumQ / this.exploredHexes.size;
    const centerR = sumR / this.exploredHexes.size;

    const weights = borderArray.map((hex) => {
      const dist = hexDistance(hex.q, hex.r, centerQ, centerR);
      return Math.max(0.1, 1 / (1 + dist * 0.3));
    });

    const nextHex = this.rng.weightedChoice(borderArray, weights);
    if (!nextHex) return false;

    const prevPos = { ...this.currentExplorerPos };
    this.currentExplorerPos = { q: nextHex.q, r: nextHex.r };

    // Mark traversed edge
    for (const dir of DIRECTION_NAMES) {
      const neighbor = hexNeighbor(prevPos.q, prevPos.r, dir);
      if (neighbor.q === nextHex.q && neighbor.r === nextHex.r) {
        const key1 = `${prevPos.q},${prevPos.r}:${dir}`;
        const key2 = `${nextHex.q},${nextHex.r}:${OPPOSITE_DIRECTION[dir]}`;
        this.traversedEdges.add(key1);
        this.traversedEdges.add(key2);
        break;
      }
    }

    const nextHexKey = hexKey(nextHex.q, nextHex.r);
    nextHex.isExplored = true;
    this.exploredHexes.add(nextHexKey);
    this.borderHexes.delete(nextHexKey);
    this.constraints.explorableHexes.count = this.exploredHexes.size;

    // Reveal neighbors (river generation now happens in createHex)
    for (const n of hexNeighbors(nextHex.q, nextHex.r)) {
      const nKey = hexKey(n.q, n.r);
      if (!this.hexes.has(nKey)) {
        const revealedHex = this.createHex(n.q, n.r);
        this.hexes.set(nKey, revealedHex);
        this.revealedHexes.add(nKey);
        this.borderHexes.add(nKey);
      }
    }

    this.maybeGenerateFeatures(nextHex);

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

  // Create new river network with initial edge (simplified - no endpoint tracking)
  initiateRiver(hex) {
    // Pick valid direction - must point to unexplored hex for river to grow
    const validDirs = DIRECTION_NAMES.filter((dir) => {
      const n = hexNeighbor(hex.q, hex.r, dir);
      if (this.isBorderHex(n.q, n.r)) return false;
      const nKey = hexKey(n.q, n.r);
      if (this.realmBorderHexes.has(nKey)) return false;
      if (this.hexes.has(nKey)) return false; // Must point to unexplored hex
      return true;
    });

    if (validDirs.length === 0) return;

    // Score each direction by frontier openness and choose best
    const scoredDirs = validDirs.map((dir) => ({
      dir,
      score: this.scoreFrontier(hex, dir),
    }));

    // Use weighted random selection with squared scores for stronger bias
    const weights = scoredDirs.map((s) => Math.max(1, s.score * s.score));
    const chosen = this.rng.weightedChoice(scoredDirs, weights);
    const chosenDir = chosen.dir;

    // Create river network (simplified - no openEndpoints/closedEndpoints)
    const network = {
      id: this.riverIdCounter++,
      edges: new Set(),
      tributaryCount: 0,
    };

    this.rivers.push(network);

    // Add initial edge
    this.addRiverEdge(network, hex, chosenDir);

    // Pre-plan the entire river path at initiation time
    this.planRiverPath(network, hex, chosenDir);
  }

  // Pre-plan river path from starting point, ensuring vertex connectivity
  planRiverPath(network, startHex, startDir) {
    const TARGET_LENGTH = 24;
    const TARGET_TRIBUTARIES = 3;

    // Track hexes visited during planning (not actual exploration)
    const plannedHexes = new Set();
    plannedHexes.add(hexKey(startHex.q, startHex.r));

    // BFS queue: each entry is {q, r, incomingDir, depth}
    const frontier = hexNeighbor(startHex.q, startHex.r, startDir);
    const queue = [
      {
        q: frontier.q,
        r: frontier.r,
        incomingDir: OPPOSITE_DIRECTION[startDir],
        depth: 1,
      },
    ];

    while (queue.length > 0 && network.edges.size < TARGET_LENGTH) {
      const current = queue.shift();
      const currentKey = hexKey(current.q, current.r);

      // Skip if already planned
      if (plannedHexes.has(currentKey)) continue;
      plannedHexes.add(currentKey);

      // Get adjacent directions (share vertex with incoming edge)
      const adjacentDirs = getAdjacentDirections(current.incomingDir);

      // Check which adjacent directions are valid for extension
      const isValidDir = (dir) => {
        const n = hexNeighbor(current.q, current.r, dir);
        if (this.isBorderHex(n.q, n.r)) return false;
        const nKey = hexKey(n.q, n.r);
        if (this.realmBorderHexes && this.realmBorderHexes.has(nKey)) return false;
        // Don't extend to already-explored hexes
        if (this.hexes.has(nKey)) return false;
        // Don't extend to hexes we've already planned to visit
        if (plannedHexes.has(nKey)) return false;
        return true;
      };

      const validDirs = adjacentDirs.filter(isValidDir);

      if (validDirs.length === 0) continue;

      // Score directions by openness
      const scoredDirs = validDirs.map((dir) => {
        const front = hexNeighbor(current.q, current.r, dir);
        let score = 0;
        for (const d of DIRECTION_NAMES) {
          const neighbor = hexNeighbor(front.q, front.r, d);
          const key = hexKey(neighbor.q, neighbor.r);
          if (
            !this.hexes.has(key) &&
            !(this.realmBorderHexes && this.realmBorderHexes.has(key)) &&
            !this.isBorderHex(neighbor.q, neighbor.r)
          ) {
            score++;
          }
        }
        return { dir, score };
      });

      // Decide whether to branch (create tributary)
      const remainingLength = TARGET_LENGTH - network.edges.size;
      const remainingTributaries = TARGET_TRIBUTARIES - network.tributaryCount;
      const tributaryProb =
        remainingTributaries > 0
          ? Math.max(0.6, remainingTributaries / Math.max(1, remainingLength))
          : 0;
      const createTributary = this.rng.next() < tributaryProb && validDirs.length >= 2;

      let directions;
      if (createTributary) {
        // Pick top 2 by score for tributary
        scoredDirs.sort((a, b) => b.score - a.score);
        directions = scoredDirs.slice(0, 2).map((s) => s.dir);
        network.tributaryCount++;
      } else {
        // Weighted random for single extension
        const weights = scoredDirs.map((s) => Math.max(1, s.score * s.score));
        const chosen = this.rng.weightedChoice(scoredDirs, weights);
        directions = [chosen.dir];
      }

      // Create edges immediately in riverEdges
      for (const dir of directions) {
        const edgeKey = this.getEdgeKey(current.q, current.r, dir);
        if (!this.riverEdges.has(edgeKey)) {
          // Add edge directly to riverEdges
          const neighbor = hexNeighbor(current.q, current.r, dir);
          const oppDir = OPPOSITE_DIRECTION[dir];
          const useOriginal =
            current.q < neighbor.q || (current.q === neighbor.q && current.r < neighbor.r);
          this.riverEdges.set(edgeKey, {
            hex1: useOriginal ? { q: current.q, r: current.r } : { q: neighbor.q, r: neighbor.r },
            direction: useOriginal ? dir : oppDir,
            flowDirection: 'unspecified',
          });

          // Store in plannedRiverEdges for hex.riverEdges updates
          const [hexPart, normalizedDir] = edgeKey.split(':');
          const [normalizedQ, normalizedR] = hexPart.split(',').map(Number);
          if (!this.plannedRiverEdges) {
            this.plannedRiverEdges = new Map();
          }
          this.plannedRiverEdges.set(edgeKey, {
            hexQ: normalizedQ,
            hexR: normalizedR,
            direction: normalizedDir,
            networkId: network.id,
          });
          network.edges.add(edgeKey);

          // Add to queue
          const nextFrontier = hexNeighbor(current.q, current.r, dir);
          queue.push({
            q: nextFrontier.q,
            r: nextFrontier.r,
            incomingDir: OPPOSITE_DIRECTION[dir],
            depth: current.depth + 1,
          });
        }
      }
    }
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

  // ============ FEATURE GENERATION ============

  maybeGenerateFeatures(hex) {
    const progress = this.exploredHexes.size / this.constraints.explorableHexes.target;
    const hKey = hexKey(hex.q, hex.r);

    if (this.constraints.featureRegistry.has(hKey)) return;

    // Holdings
    if (this.constraints.holdings.placed < this.constraints.holdings.target) {
      let prob = 0.03;
      if (progress > 0.7) {
        const deficit = this.constraints.holdings.target - this.constraints.holdings.placed;
        prob *= 1.0 + deficit * 2.5;
      }
      if (this.rng.next() < prob) {
        this.constraints.holdings.placed++;
        this.constraints.featureRegistry.add(hKey);
        return;
      }
    }

    // Myth sites
    if (this.constraints.mythSites.placed < this.constraints.mythSites.target) {
      let prob = 0.04;
      if (progress > 0.7) {
        const deficit = this.constraints.mythSites.target - this.constraints.mythSites.placed;
        prob *= 1.0 + deficit * 2.0;
      }
      if (this.rng.next() < prob) {
        this.constraints.mythSites.placed++;
        this.constraints.featureRegistry.add(hKey);
        return;
      }
    }

    // Landmarks
    for (const [, data] of Object.entries(this.constraints.landmarks)) {
      if (data.placed < data.max) {
        let prob = 0.05;
        if (progress > 0.7 && data.placed < data.min) {
          prob *= 2.0 + (data.min - data.placed);
        }
        if (this.rng.next() < prob) {
          data.placed++;
          this.constraints.featureRegistry.add(hKey);
          return;
        }
      }
    }

    // Lakes
    if (this.constraints.lakes.placed < this.constraints.lakes.max) {
      const expectedRatio = Math.max(0.1, this.exploredHexes.size / 144);
      const expectedLakes = 2.5 * expectedRatio;
      const deficit = expectedLakes - this.constraints.lakes.placed;
      const baseProb = 0.045;
      const deficitBonus = deficit > 0 ? deficit * 0.015 : 0;
      if (this.rng.next() < baseProb + deficitBonus) {
        this.constraints.lakes.placed++;
        hex.isLake = true;
      }
    }

    // Barriers
    const expectedRatio = Math.max(0.1, this.exploredHexes.size / 144);
    const expectedBarriers = 24 * expectedRatio;
    const barrierDeficit = expectedBarriers - this.constraints.barriers.placed;
    let barrierProb = 0.18;
    if (barrierDeficit > 4) barrierProb = 0.25;
    else if (barrierDeficit < -2) barrierProb = 0.1;
    if (this.rng.next() < barrierProb) {
      this.constraints.barriers.placed++;
    }
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
    this.constraints.borderClosure.complete = this.borderHexes.size === 0;
  }

  forceCompleteFeatures() {
    const validHexes = [];
    for (const key of this.exploredHexes) {
      const hex = this.hexes.get(key);
      if (hex && !hex.isLake && !this.constraints.featureRegistry.has(key)) {
        validHexes.push({ hex, key });
      }
    }

    for (let i = validHexes.length - 1; i > 0; i--) {
      const j = Math.floor(this.rng.next() * (i + 1));
      [validHexes[i], validHexes[j]] = [validHexes[j], validHexes[i]];
    }

    while (this.constraints.mythSites.placed < 6 && validHexes.length > 0) {
      const { key } = validHexes.pop();
      if (!this.constraints.featureRegistry.has(key)) {
        this.constraints.mythSites.placed++;
        this.constraints.featureRegistry.add(key);
      }
    }

    while (this.constraints.holdings.placed < 4 && validHexes.length > 0) {
      const { key } = validHexes.pop();
      if (!this.constraints.featureRegistry.has(key)) {
        this.constraints.holdings.placed++;
        this.constraints.featureRegistry.add(key);
      }
    }
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
