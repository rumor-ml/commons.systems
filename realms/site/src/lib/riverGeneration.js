/**
 * River Generation Logic
 *
 * Vertex-centric river initialization algorithm that ensures both endpoints
 * of the initial river segment lead to unrevealed territory.
 */

import {
  DIRECTION_NAMES,
  OPPOSITE_DIRECTION,
  hexNeighbor,
  hexKey,
  getAdjacentDirections,
  getVertexDirections,
  getEdgesBetweenVertices,
} from './hexMath.js';

/**
 * RiverNetwork class with validated operations to enforce invariants
 */
class RiverNetwork {
  static MAX_EDGES = 24;
  static MAX_TRIBUTARIES = 3;

  constructor(id) {
    if (!Number.isInteger(id) || id < 0) {
      throw new Error(`Invalid network ID: ${id}`);
    }
    this.id = id;
    this._edges = new Set();
    this._tributaryCount = 0;
  }

  canAddEdge() {
    return this._edges.size < RiverNetwork.MAX_EDGES;
  }

  addEdge(edgeKey) {
    if (!this.canAddEdge()) {
      throw new Error(`Network ${this.id} at max size ${RiverNetwork.MAX_EDGES}`);
    }
    this._edges.add(edgeKey);
  }

  get edges() {
    return this._edges;
  }

  get tributaryCount() {
    return this._tributaryCount;
  }

  canAddTributary() {
    return this._tributaryCount < RiverNetwork.MAX_TRIBUTARIES;
  }

  incrementTributaries() {
    if (!this.canAddTributary()) {
      throw new Error(`Network ${this.id} at max tributaries ${RiverNetwork.MAX_TRIBUTARIES}`);
    }
    this._tributaryCount++;
  }
}

/**
 * Initiate a new river at the given hex using vertex-centric algorithm
 *
 * Algorithm:
 * 1. ENUMERATE VERTICES with unrevealed connections
 * 2. REQUIRE at least 2 valid vertices
 * 3. FIND VALID PAIRS (vertices that can connect via 1-2 edges)
 * 4. SELECT best pair (highest score = total unrevealed connections)
 * 5. ADD CONNECTING EDGES
 * 6. PLAN PATHS from both endpoints
 *
 * @param {Object} ctx - Context object with rng, hexes, isBorderHex, rivers, riverEdges, addRiverEdge, planRiverPath
 * @param {Object} hex - The hex where the river initiates
 */
export function initiateRiver(ctx, hex) {
  // STEP 1: ENUMERATE VERTICES with unrevealed connections
  const vertexCandidates = [];

  for (let vertexIndex = 0; vertexIndex < 6; vertexIndex++) {
    const [dir1, dir2] = getVertexDirections(vertexIndex);

    // Check both adjacent edges for unrevealed connections
    let unrevealedCount = 0;
    const unrevealedDirs = [];

    for (const dir of [dir1, dir2]) {
      const n = hexNeighbor(hex.q, hex.r, dir);
      if (ctx.isBorderHex(n.q, n.r)) continue;
      const nKey = hexKey(n.q, n.r);
      if (ctx.hexes.has(nKey)) continue; // Already explored/revealed
      unrevealedCount++;
      unrevealedDirs.push(dir);
    }

    if (unrevealedCount === 2) {
      vertexCandidates.push({
        vertexIndex,
        unrevealedCount,
        unrevealedDirs,
      });
    }
  }

  // STEP 2: REQUIRE at least 2 valid vertices
  if (vertexCandidates.length < 2) return;

  // STEP 3: FIND VALID PAIRS
  const validPairs = [];

  for (let i = 0; i < vertexCandidates.length; i++) {
    for (let j = i + 1; j < vertexCandidates.length; j++) {
      const v1 = vertexCandidates[i];
      const v2 = vertexCandidates[j];

      // Calculate distance between vertices (number of edges between them)
      const dist = Math.min(
        Math.abs(v2.vertexIndex - v1.vertexIndex),
        6 - Math.abs(v2.vertexIndex - v1.vertexIndex)
      );

      // Valid pairs have distance <= 2 (share 1-2 edges)
      if (dist <= 2) {
        const score = v1.unrevealedCount + v2.unrevealedCount;
        validPairs.push({
          v1,
          v2,
          dist,
          score,
        });
      }
    }
  }

  if (validPairs.length === 0) return;

  // STEP 4: SELECT best pair (highest score, random among ties)
  const maxScore = Math.max(...validPairs.map((p) => p.score));
  const bestPairs = validPairs.filter((p) => p.score === maxScore);
  const chosenPair = ctx.rng.choice(bestPairs);

  // STEP 5: ADD CONNECTING EDGES
  const edgeDirs = getEdgesBetweenVertices(chosenPair.v1.vertexIndex, chosenPair.v2.vertexIndex);

  // Filter out edges that lead to already-revealed hexes
  const validEdgeDirs = edgeDirs.filter((dir) => {
    const n = hexNeighbor(hex.q, hex.r, dir);
    const nKey = hexKey(n.q, n.r);
    return !ctx.hexes.has(nKey); // Only include edges to unrevealed hexes
  });

  // If no valid edges after filtering, abort (shouldn't happen if vertices were properly validated)
  if (validEdgeDirs.length === 0) return;

  // Create river network
  const network = new RiverNetwork(ctx.riverIdCounter++);
  ctx.rivers.push(network);

  // Add connecting edges
  for (const dir of validEdgeDirs) {
    ctx.addRiverEdge(network, hex, dir);
  }

  // STEP 6: PLAN PATHS from both endpoints
  // Ensure we pick DIFFERENT directions to create distinct outward paths
  const v1Dir = ctx.rng.choice(chosenPair.v1.unrevealedDirs);
  ctx.planRiverPath(network, hex, v1Dir);

  // From v2: pick a direction different from v1Dir if possible
  let v2Dir;
  const v2Options = chosenPair.v2.unrevealedDirs.filter((d) => d !== v1Dir);
  if (v2Options.length > 0) {
    v2Dir = ctx.rng.choice(v2Options);
  } else {
    // If all of v2's directions match v1Dir, just pick one
    v2Dir = ctx.rng.choice(chosenPair.v2.unrevealedDirs);
  }
  ctx.planRiverPath(network, hex, v2Dir);
}

/**
 * Pre-plan river path from starting point, ensuring vertex connectivity
 *
 * @param {Object} ctx - Context object with rng, hexes, isBorderHex, riverEdges, plannedRiverEdges
 * @param {Object} network - River network object with id, edges Set, tributaryCount
 * @param {Object} startHex - Starting hex coordinates {q, r}
 * @param {string} startDir - Starting direction
 */
export function planRiverPath(ctx, network, startHex, startDir) {
  const TARGET_LENGTH = RiverNetwork.MAX_EDGES;
  const TARGET_TRIBUTARIES = RiverNetwork.MAX_TRIBUTARIES;

  // Track hexes visited during planning (not actual exploration)
  const plannedHexes = new Set();
  plannedHexes.add(hexKey(startHex.q, startHex.r));

  // Track the initiation hex to avoid paths that lead back to it
  const initiationHexKey = hexKey(startHex.q, startHex.r);

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
      if (ctx.isBorderHex(n.q, n.r)) return false;
      const nKey = hexKey(n.q, n.r);
      // Don't extend to already-explored hexes
      if (ctx.hexes.has(nKey)) return false;
      // Don't extend to the initiation hex (it may not be in ctx.hexes yet)
      if (nKey === initiationHexKey) return false;
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
        if (!ctx.hexes.has(key) && !ctx.isBorderHex(neighbor.q, neighbor.r)) {
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
    const createTributary = ctx.rng.next() < tributaryProb && validDirs.length >= 2;

    let directions;
    if (createTributary) {
      // Pick top 2 by score for tributary
      scoredDirs.sort((a, b) => b.score - a.score);
      directions = scoredDirs.slice(0, 2).map((s) => s.dir);
      network.incrementTributaries();
    } else {
      // Weighted random for single extension
      const weights = scoredDirs.map((s) => Math.max(1, s.score * s.score));
      const chosen = ctx.rng.weightedChoice(scoredDirs, weights);
      directions = [chosen.dir];
    }

    // Create edges immediately in riverEdges
    for (const dir of directions) {
      const edgeKey = getEdgeKey(current.q, current.r, dir);
      if (!ctx.riverEdges.has(edgeKey)) {
        // Add edge directly to riverEdges
        const neighbor = hexNeighbor(current.q, current.r, dir);
        const oppDir = OPPOSITE_DIRECTION[dir];
        const useOriginal =
          current.q < neighbor.q || (current.q === neighbor.q && current.r < neighbor.r);
        ctx.riverEdges.set(edgeKey, {
          hex1: useOriginal ? { q: current.q, r: current.r } : { q: neighbor.q, r: neighbor.r },
          direction: useOriginal ? dir : oppDir,
          flowDirection: 'unspecified',
        });

        // Store in plannedRiverEdges for hex.riverEdges updates
        const [hexPart, normalizedDir] = edgeKey.split(':');
        const [normalizedQ, normalizedR] = hexPart.split(',').map(Number);
        if (!ctx.plannedRiverEdges) {
          ctx.plannedRiverEdges = new Map();
        }
        ctx.plannedRiverEdges.set(edgeKey, {
          hexQ: normalizedQ,
          hexR: normalizedR,
          direction: normalizedDir,
          networkId: network.id,
        });
        network.addEdge(edgeKey);

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

/**
 * Get canonical edge key for an edge (normalized to use the hex with smaller q,r coordinates)
 * Ensures each edge has exactly one representation regardless of which hex it's accessed from.
 */
function getEdgeKey(q, r, direction) {
  const neighbor = hexNeighbor(q, r, direction);
  const oppDir = OPPOSITE_DIRECTION[direction];
  if (q < neighbor.q || (q === neighbor.q && r < neighbor.r)) {
    return `${q},${r}:${direction}`;
  }
  return `${neighbor.q},${neighbor.r}:${oppDir}`;
}
