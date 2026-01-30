/**
 * Shared Realm Generation Logic
 *
 * This module contains all RNG-consuming functions used during realm generation.
 * Both the UI (MythicBastionlandRealms.jsx) and simulator (constraint-simulator.mjs)
 * use these functions to ensure deterministic generation with matching RNG consumption.
 *
 * KEY PRINCIPLE: Functions consume RNG values in the exact same order regardless of
 * implementation. The UI may use results for rendering/tracking, while the simulator
 * may ignore some results, but both MUST call the same functions in the same order.
 */

import {
  hexNeighbor,
  hexKey,
  hexNeighbors,
  hexDistance,
  OPPOSITE_DIRECTION,
  parseHexKey,
  getAdjacentDirections,
} from './hexMath.js';
import { HOLDING_TYPES } from './terrainConstants.js';

/**
 * Check if a barrier exists between two hexes (checks both edge key formats)
 *
 * @param {Set} barrierSet - Set of barrier edge keys
 * @param {number} q - Hex q coordinate
 * @param {number} r - Hex r coordinate
 * @param {string} direction - Direction to neighbor
 * @returns {boolean} True if barrier exists
 */
export function hasBarrierBetween(barrierSet, q, r, direction) {
  const neighbor = hexNeighbor(q, r, direction);
  const oppDir = OPPOSITE_DIRECTION[direction];
  const key1 = `${q},${r}:${direction}`;
  const key2 = `${neighbor.q},${neighbor.r}:${oppDir}`;
  return barrierSet.has(key1) || barrierSet.has(key2);
}

/**
 * Check if blocking a target hex would eliminate the explorer's only traversable path forward
 *
 * @param {Object} ctx - Context object with { hexes, exploredHexes, barrierEdges, realmRadius }
 * @param {number} targetQ - Target hex q coordinate
 * @param {number} targetR - Target hex r coordinate
 * @param {Object} explorerPos - Explorer position { q, r }
 * @returns {boolean} True if blocking target would eliminate only path
 */
export function wouldBlockOnlyPath(ctx, targetQ, targetR, explorerPos) {
  if (!explorerPos) return false;
  if (!ctx.hexes || !ctx.exploredHexes || !ctx.barrierEdges) return false;

  // Get all neighbors of explorer position
  const neighbors = hexNeighbors(explorerPos.q, explorerPos.r);
  let potentialPaths = 0;

  for (const n of neighbors) {
    const nKey = hexKey(n.q, n.r);

    // Skip the target hex we're considering blocking
    if (n.q === targetQ && n.r === targetR) continue;

    // Skip positions beyond realm boundary
    const dist = hexDistance(0, 0, n.q, n.r);
    if (dist >= ctx.realmRadius) continue;

    // Check if barrier blocks this edge
    if (hasBarrierBetween(ctx.barrierEdges, explorerPos.q, explorerPos.r, n.direction)) continue;

    const nHex = ctx.hexes.get(nKey);

    // Ungenerated hex = potential path (optimistic)
    if (!nHex) {
      potentialPaths++;
      continue;
    }

    // Skip if border or lake
    if (nHex.isBorder) continue;
    if (nHex.isLake) continue;

    // Skip if already explored - we need NEW paths forward
    if (ctx.exploredHexes.has(nKey)) continue;

    // This is an unexplored passable hex - count it as a potential path
    potentialPaths++;
  }

  // Would block only path if no potential paths remain
  return potentialPaths === 0;
}

/**
 * Check if placing a barrier or lake would trap the explorer or create isolated regions
 *
 * @param {Object} ctx - Context object with { hexes, exploredHexes, revealedHexes, currentExplorerPos, barrierEdges, realmRadius }
 * @param {string} barrierEdgeKey - Edge key for proposed barrier (or null)
 * @param {string} lakeHexKey - Hex key for proposed lake (or null)
 * @returns {boolean} True if placement would trap explorer
 */
export function wouldTrapExplorer(ctx, barrierEdgeKey, lakeHexKey = null) {
  // Get all currently explored hexes that need to remain connected
  if (ctx.exploredHexes.size === 0) return false;

  // Build a graph of passable hexes and check connectivity
  const explorerPos = ctx.currentExplorerPos;
  if (!explorerPos) return false;

  // Simulate the placement and check if explorer still has valid moves
  const tempBarriers = new Set(ctx.barrierEdges);
  if (barrierEdgeKey) tempBarriers.add(barrierEdgeKey);

  const tempLakes = new Set();
  for (const [key, hex] of ctx.hexes) {
    if (hex.isLake) tempLakes.add(key);
  }
  if (lakeHexKey) tempLakes.add(lakeHexKey);

  // Check if explorer's current position would have any valid moves
  const neighbors = hexNeighbors(explorerPos.q, explorerPos.r);
  let validMoveCount = 0;
  let unexploredMoveCount = 0;

  for (const n of neighbors) {
    const nKey = hexKey(n.q, n.r);

    // Check if this would be a border position
    const dist = hexDistance(0, 0, n.q, n.r);
    if (dist >= ctx.realmRadius) continue;

    const nHex = ctx.hexes.get(nKey);

    // Only count generated, passable hexes as valid moves
    // Ungenerated hexes might become lakes in same batch - don't count them
    if (!nHex) continue;

    // Skip if border or lake (including simulated lake)
    if (nHex.isBorder) continue;
    if (tempLakes.has(nKey)) continue;

    // Check if barrier blocks this edge (check both key formats)
    const neighbor = hexNeighbor(explorerPos.q, explorerPos.r, n.direction);
    const oppDir = OPPOSITE_DIRECTION[n.direction];
    const key1 = `${explorerPos.q},${explorerPos.r}:${n.direction}`;
    const key2 = `${neighbor.q},${neighbor.r}:${oppDir}`;
    if (tempBarriers.has(key1) || tempBarriers.has(key2)) continue;

    // This is a valid move
    validMoveCount++;

    // Track unexplored moves separately
    if (!ctx.exploredHexes.has(nKey)) {
      unexploredMoveCount++;
    }
  }

  // Explorer is trapped if no valid moves from current position
  if (validMoveCount === 0) return true;

  // If explorer has many options (>= 4), allow obstacle without strict escape check
  // This allows lakes/barriers early in exploration when there's plenty of room
  const hasAmpleOptions = validMoveCount >= 4;

  // Also check that we don't create isolated pockets in explored territory
  // Use flood fill from explorer position to ensure all explored hexes are reachable
  const reachable = new Set();
  const queue = [hexKey(explorerPos.q, explorerPos.r)];
  reachable.add(queue[0]);

  while (queue.length > 0) {
    const currentKey = queue.shift();
    const current = parseHexKey(currentKey);
    const currentNeighbors = hexNeighbors(current.q, current.r);

    for (const n of currentNeighbors) {
      const nKey = hexKey(n.q, n.r);
      if (reachable.has(nKey)) continue;

      const nHex = ctx.hexes.get(nKey);
      if (!nHex) continue;
      if (nHex.isBorder) continue;
      if (tempLakes.has(nKey)) continue;

      // Check barrier (check both key formats)
      const neighbor = hexNeighbor(current.q, current.r, n.direction);
      const oppDir = OPPOSITE_DIRECTION[n.direction];
      const key1 = `${current.q},${current.r}:${n.direction}`;
      const key2 = `${neighbor.q},${neighbor.r}:${oppDir}`;
      if (tempBarriers.has(key1) || tempBarriers.has(key2)) continue;

      // Only consider revealed/explored hexes for connectivity check
      if (!ctx.revealedHexes.has(nKey)) continue;

      reachable.add(nKey);
      queue.push(nKey);
    }
  }

  // Check if any explored (non-lake, non-border) hexes are unreachable
  for (const expKey of ctx.exploredHexes) {
    const expHex = ctx.hexes.get(expKey);
    if (expHex && !expHex.isBorder && !expHex.isLake && !tempLakes.has(expKey)) {
      if (!reachable.has(expKey)) {
        return true; // Would create isolated pocket
      }
    }
  }

  // Check that explorer can still reach unexplored territory
  // Use BFS from explorer position through REVEALED hexes only
  // Require escape to be reachable through at least one other revealed hex (not just direct from explorer)
  // This prevents lakes from being placed when they would reduce access to a single chokepoint
  const explorerKey = hexKey(explorerPos.q, explorerPos.r);
  const frontierQueue = [{ key: explorerKey, depth: 0 }];
  const frontierVisited = new Set([explorerKey]);

  while (frontierQueue.length > 0) {
    const { key: currentKey, depth } = frontierQueue.shift();
    const current = parseHexKey(currentKey);
    const currentNeighbors = hexNeighbors(current.q, current.r);

    // Only consider escape routes reachable from revealed hexes
    const currentIsRevealed = ctx.revealedHexes.has(currentKey);

    for (const n of currentNeighbors) {
      const nKey = hexKey(n.q, n.r);
      if (frontierVisited.has(nKey)) continue;

      // Check if this would be a border
      const dist = hexDistance(0, 0, n.q, n.r);
      if (dist >= ctx.realmRadius) continue;

      // Check barrier
      const neighbor = hexNeighbor(current.q, current.r, n.direction);
      const oppDir = OPPOSITE_DIRECTION[n.direction];
      const key1 = `${current.q},${current.r}:${n.direction}`;
      const key2 = `${neighbor.q},${neighbor.r}:${oppDir}`;
      if (tempBarriers.has(key1) || tempBarriers.has(key2)) continue;

      const nHex = ctx.hexes.get(nKey);

      // Skip lakes (including simulated)
      if (tempLakes.has(nKey)) continue;
      if (nHex && nHex.isLake) continue;
      if (nHex && nHex.isBorder) continue;

      // Check if this is an ungenerated position
      if (!nHex) {
        // If explorer has ample options (>= 4 valid moves), ungenerated positions are OK
        // because even if some become lakes, there are enough alternatives.
        // But if explorer has fewer options, DON'T count ungenerated positions as escape
        // routes - they might become lakes in the same generation batch.
        if (hasAmpleOptions && currentIsRevealed) {
          return false; // Not trapped - has many moves and can reach unexplored territory
        }
        continue; // Otherwise, don't count ungenerated positions
      }

      // Valid escape route: revealed, unexplored, passable hex
      // This hex exists so we KNOW it's not a lake/border
      const isUnexplored = !ctx.exploredHexes.has(nKey);
      const isRevealed = ctx.revealedHexes.has(nKey);
      if (isUnexplored && isRevealed && depth > 0) {
        return false; // Not trapped - can reach unexplored territory via existing passable hex
      }

      // Continue BFS through passable hexes
      frontierVisited.add(nKey);
      // Only increment depth when moving through revealed hex
      const newDepth = isRevealed ? depth + 1 : depth;
      frontierQueue.push({ key: nKey, depth: newDepth });
    }
  }

  // No path to unexplored territory found - would trap explorer
  return true;
}

/**
 * Create a border hex with type selection based on neighbor affinity
 *
 * @param {Object} ctx - Context object with { rng, hexes, borderHexes, borderTypes }
 * @param {number} q - Hex q coordinate
 * @param {number} r - Hex r coordinate
 * @returns {Object} Border hex object or null if hex already exists
 */
export function createBorderHex(ctx, q, r) {
  const key = hexKey(q, r);
  if (ctx.hexes.has(key)) return null;

  // Determine border type
  let borderType = ctx.rng.choice(ctx.borderTypes);

  // Check for adjacent border hexes of specific type (type clustering)
  const neighbors = hexNeighbors(q, r);
  for (const n of neighbors) {
    const nKey = hexKey(n.q, n.r);
    const nHex = ctx.hexes.get(nKey);
    if (nHex && nHex.isBorder) {
      if (ctx.rng.next() < 0.7) {
        borderType = nHex.borderType;
      }
      break;
    }
  }

  const borderHex = {
    q,
    r,
    isBorder: true,
    borderType: borderType,
    revealed: false,
  };

  ctx.hexes.set(key, borderHex);
  ctx.borderHexes.add(key);

  return borderHex;
}

/**
 * Determine if a hex should be a lake based on probabilistic rules
 *
 * @param {Object} ctx - Context object with { rng, hexes, constraints, wouldTrapExplorer, currentExplorerPos, exploredHexes, barrierEdges, realmRadius }
 * @param {number} q - Hex q coordinate
 * @param {number} r - Hex r coordinate
 * @returns {boolean} True if this hex should be a lake
 */
export function shouldBeLake(ctx, q, r) {
  const thisKey = hexKey(q, r);

  // HARD CONSTRAINT: Check if making this a lake would block only path (optimistic check)
  if (ctx.currentExplorerPos && wouldBlockOnlyPath(ctx, q, r, ctx.currentExplorerPos)) {
    return false;
  }

  // Don't create lakes in early exploration (reduces early trapping)
  // Wait until there's more established territory before allowing lakes
  const exploredCount = ctx.constraints?.explorableHexes?.count || 0;
  if (exploredCount < 25) {
    return false;
  }

  if (ctx.constraints.lakes.placed >= ctx.constraints.lakes.max) {
    // Soft constraint - still allow with low probability
    if (ctx.rng.next() > 0.1) return false;
  }

  // Check for adjacent lake to extend and calculate water affinity bonus
  const neighbors = hexNeighbors(q, r);
  let adjacentLake = null;
  let waterAffinityBonus = 0;

  for (const n of neighbors) {
    const nKey = hexKey(n.q, n.r);
    const nHex = ctx.hexes.get(nKey);

    // HARD CONSTRAINT: Never adjacent to sea (ocean)
    if (nHex && nHex.isBorder && nHex.borderType === 'sea') {
      return false;
    }

    if (nHex && nHex.isLake) {
      adjacentLake = nHex;
    }

    // Water feature affinity (soft constraint)
    if (nHex && nHex.riverEdges && nHex.riverEdges.length > 0) {
      waterAffinityBonus += 0.02;
    }

    // Wetland affinity (soft constraint)
    if (nHex && (nHex.terrain === 'bog' || nHex.terrain === 'marsh')) {
      waterAffinityBonus += 0.015;
    }
  }

  if (adjacentLake) {
    // Extend lake with decreasing probability based on size
    // Note: ctx.lakes array may not exist in simulator, but RNG consumption must match
    if (ctx.lakes) {
      const lakeInfo = ctx.lakes.find((l) => l.hexes.has(hexKey(adjacentLake.q, adjacentLake.r)));
      if (lakeInfo && lakeInfo.hexes.size < 6) {
        return ctx.rng.next() < 0.4;
      }
      return false;
    } else {
      // Simulator: consume RNG but assume lakeInfo doesn't exist
      return ctx.rng.next() < 0.4;
    }
  }

  // New lake probability with deficit compensation and water affinity
  if (ctx.constraints.lakes.placed < ctx.constraints.lakes.max) {
    const expectedTotalHexes = 144;
    const exploredRatio = Math.max(0.1, ctx.constraints.explorableHexes.count / expectedTotalHexes);
    const targetLakes = 2.5;
    const expectedLakes = targetLakes * exploredRatio;
    const deficit = expectedLakes - ctx.constraints.lakes.placed;

    const baseProb = 0.045;
    const deficitBonus = deficit > 0 ? deficit * 0.015 : 0;
    return ctx.rng.next() < baseProb + deficitBonus + waterAffinityBonus;
  }

  return false;
}

/**
 * Generate terrain type with neighbor affinity and river elevation constraints
 *
 * @param {Object} ctx - Context object with { rng, hexes, terrainTypes, terrainAffinities, terrainClusters, isBorderHex, getRiverConstraints, getElevation }
 * @param {number} q - Hex q coordinate
 * @param {number} r - Hex r coordinate
 * @returns {string} Terrain type
 */
export function generateTerrainWithConstraints(ctx, q, r) {
  const hex = ctx.hexes.get(hexKey(q, r));
  if (!hex) {
    // Fallback: simple terrain generation
    return ctx.rng.weightedChoice(ctx.terrainTypes, ctx.terrainWeights || [30, 25, 15, 10, 10, 10]);
  }

  const riverConstraints = ctx.getRiverConstraints
    ? ctx.getRiverConstraints(hex)
    : { minElevation: 0, maxElevation: 10 };

  // If constraints are impossible, make it a lake
  if (riverConstraints.minElevation > riverConstraints.maxElevation) {
    return 'lake';
  }

  // Get valid terrains based on elevation constraints
  const validTerrains = ctx.terrainTypes.filter((t) => {
    const elev = ctx.getElevation(t);
    return elev >= riverConstraints.minElevation && elev <= riverConstraints.maxElevation;
  });

  if (validTerrains.length === 0) {
    return 'lake';
  }

  // Analyze neighbors
  const neighbors = hexNeighbors(q, r);
  const adjacentTerrains = [];
  const adjacentClusters = new Map();
  let hasWaterAdjacent = false;
  let hasCliffAdjacent = false;

  for (const n of neighbors) {
    const nKey = hexKey(n.q, n.r);
    const nHex = ctx.hexes.get(nKey);
    if (nHex) {
      if (nHex.isBorder) {
        if (nHex.borderType === 'sea') hasWaterAdjacent = true;
        if (nHex.borderType === 'cliff') hasCliffAdjacent = true;
      } else if (nHex.isLake) {
        hasWaterAdjacent = true;
      } else if (nHex.terrain) {
        adjacentTerrains.push(nHex.terrain);
        if (ctx.terrainClusters && nHex.clusterId !== null && nHex.clusterId !== undefined) {
          const cluster = ctx.terrainClusters.get(nHex.clusterId);
          if (cluster) {
            adjacentClusters.set(nHex.clusterId, cluster);
          }
        }
      }
      if (nHex.riverEdges && nHex.riverEdges.length > 0) {
        hasWaterAdjacent = true;
      }
    }
  }

  // Calculate weights for valid terrains
  const weights = validTerrains.map((t) => {
    let weight = 1;

    const affinities = ctx.terrainAffinities[t] || {};

    for (const adjTerrain of adjacentTerrains) {
      if (affinities[adjTerrain]) {
        weight += affinities[adjTerrain];
      }
    }

    if (hasWaterAdjacent && affinities.waterAdjacent) {
      weight += affinities.waterAdjacent;
    }

    if (hasCliffAdjacent && affinities.cliffAdjacent) {
      weight += affinities.cliffAdjacent;
    }

    for (const [, cluster] of adjacentClusters) {
      if (cluster.terrain === t) {
        const clusterSize = cluster.hexes.size;
        if (clusterSize < 3) {
          weight += 4;
        } else if (clusterSize < 6) {
          weight += 3;
        } else if (clusterSize < 12) {
          weight += 1;
        }
      }
    }

    return weight;
  });

  return ctx.rng.weightedChoice(validTerrains, weights);
}

/**
 * Maybe generate a barrier on an edge between two hexes
 *
 * @param {Object} ctx - Context object with { rng, constraints, barrierEdges, traversedEdges, currentExplorerPos, wouldTrapExplorer, generationMode, hexes, exploredHexes, realmRadius }
 * @param {Object} hex - The hex object
 * @param {string} direction - Direction to the neighbor
 * @param {Object} neighborHex - The neighbor hex object
 * @returns {boolean} True if a barrier was placed
 */
export function maybeGenerateBarrier(ctx, hex, direction, neighborHex) {
  // Skip during validation mode
  if (ctx.generationMode === 'validation') {
    return false;
  }

  if (!neighborHex) return false;

  // Never place on edges touching lake hexes
  if (hex.isLake || neighborHex.isLake) return false;

  // Skip if hex is a border (barriers are only placed on explorable hex edges)
  if (hex.isBorder) return false;

  // Check both possible key formats using shared function
  if (hasBarrierBetween(ctx.barrierEdges, hex.q, hex.r, direction)) return false;

  const edgeKey1 = `${hex.q},${hex.r}:${direction}`;
  const oppDir = OPPOSITE_DIRECTION[direction];
  const edgeKey2 = `${neighborHex.q},${neighborHex.r}:${oppDir}`;

  // Never place on traversed edges (only applies to explorable-to-explorable barriers)
  if (!neighborHex.isBorder) {
    if (ctx.traversedEdges.has(edgeKey1) || ctx.traversedEdges.has(edgeKey2)) return false;
  }

  // Never place adjacent to explorer's current position (only for explorable-to-explorable)
  if (!neighborHex.isBorder && ctx.currentExplorerPos) {
    const explorerQ = ctx.currentExplorerPos.q;
    const explorerR = ctx.currentExplorerPos.r;
    if (
      (hex.q === explorerQ && hex.r === explorerR) ||
      (neighborHex.q === explorerQ && neighborHex.r === explorerR)
    ) {
      return false;
    }
  }

  const edgeKey = edgeKey1;

  // Path blocking checks only apply to explorable-to-explorable barriers
  if (!neighborHex.isBorder) {
    // Check if barrier would block neighbor's only path forward (optimistic check)
    if (
      ctx.currentExplorerPos &&
      wouldBlockOnlyPath(ctx, neighborHex.q, neighborHex.r, ctx.currentExplorerPos)
    ) {
      return false;
    }

    // Check if would trap explorer
    if (ctx.wouldTrapExplorer && ctx.wouldTrapExplorer(edgeKey, null)) {
      return false;
    }
  }

  // HARD CONSTRAINT: Barriers must be connected to the map edge
  // Either directly (anchor point) or via existing anchored barriers
  const isAnchor = isEdgeAnchorPoint(ctx, hex.q, hex.r, direction);
  const isConnectedToAnchored = isEdgeConnectedToAnchoredNetwork(ctx, hex.q, hex.r, direction);

  if (!isAnchor && !isConnectedToAnchored) {
    return false; // Cannot place unconnected barrier
  }

  // Calculate barrier probability
  const currentBarriers = ctx.constraints.barriers.placed;
  const targetBarriers = 24;
  const expectedTotalHexes = 144;
  const exploredRatio = Math.max(0.1, ctx.constraints.explorableHexes.count / expectedTotalHexes);
  const expectedBarriers = targetBarriers * exploredRatio;
  const barrierDeficit = expectedBarriers - currentBarriers;

  let baseProb = 0.18;
  if (barrierDeficit > 4) {
    baseProb = 0.25;
  } else if (barrierDeficit < -2) {
    baseProb = 0.1;
  }

  // Cluster bonus (adjacent barriers) using shared function
  let clusterBonus = 0;
  const adjacentDirs = getAdjacentDirections(direction);
  for (const adjDir of adjacentDirs) {
    if (hasBarrierBetween(ctx.barrierEdges, hex.q, hex.r, adjDir)) {
      clusterBonus += 0.25;
    }
  }

  const barrierProb = Math.min(0.7, baseProb + clusterBonus);

  if (ctx.rng.next() < barrierProb) {
    ctx.barrierEdges.add(edgeKey);
    // All placed barriers are guaranteed to be anchored
    if (ctx.anchoredBarrierEdges) {
      ctx.anchoredBarrierEdges.add(edgeKey);
    }
    if (hex.barrierEdges) {
      hex.barrierEdges.push(direction);
    }
    ctx.constraints.barriers.placed++;
    return true;
  }

  return false;
}

/**
 * Check if all barriers are connected to the map border (no islands)
 *
 * @param {Object} ctx - Context with { barrierEdges, hexes, realmRadius }
 * @returns {{ connected: boolean, islandCount: number, islandEdges: string[] }}
 */
export function checkBarrierConnectivity(ctx) {
  const { barrierEdges, hexes, realmRadius } = ctx;

  if (!barrierEdges || barrierEdges.size === 0) {
    return { connected: true, islandCount: 0, islandEdges: [] };
  }

  // Find all barriers that directly touch the border
  const borderConnected = new Set();
  for (const edgeKey of barrierEdges) {
    const [coords, direction] = edgeKey.split(':');
    const [q, r] = coords.split(',').map(Number);
    const neighbor = hexNeighbor(q, r, direction);
    const neighborKey = hexKey(neighbor.q, neighbor.r);
    const neighborHex = hexes.get(neighborKey);

    if (
      (neighborHex && neighborHex.isBorder) ||
      (realmRadius && hexDistance(0, 0, neighbor.q, neighbor.r) >= realmRadius)
    ) {
      borderConnected.add(edgeKey);
    }
  }

  // BFS to find all barriers connected via shared vertices
  const visited = new Set(borderConnected);
  const queue = [...borderConnected];

  while (queue.length > 0) {
    const currentKey = queue.shift();
    const [coords, direction] = currentKey.split(':');
    const [q, r] = coords.split(',').map(Number);

    // Check adjacent edges on this hex
    for (const adjDir of getAdjacentDirections(direction)) {
      if (hasBarrierBetween(barrierEdges, q, r, adjDir)) {
        const adjKey = `${q},${r}:${adjDir}`;
        if (!visited.has(adjKey)) {
          visited.add(adjKey);
          queue.push(adjKey);
        }
        // Also check alternate key format
        const adjNeighbor = hexNeighbor(q, r, adjDir);
        const altKey = `${adjNeighbor.q},${adjNeighbor.r}:${OPPOSITE_DIRECTION[adjDir]}`;
        if (barrierEdges.has(altKey) && !visited.has(altKey)) {
          visited.add(altKey);
          queue.push(altKey);
        }
      }
    }

    // Check adjacent edges on neighbor hex
    const edgeNeighbor = hexNeighbor(q, r, direction);
    const oppDir = OPPOSITE_DIRECTION[direction];
    for (const adjDir of getAdjacentDirections(oppDir)) {
      if (hasBarrierBetween(barrierEdges, edgeNeighbor.q, edgeNeighbor.r, adjDir)) {
        const adjKey = `${edgeNeighbor.q},${edgeNeighbor.r}:${adjDir}`;
        if (!visited.has(adjKey)) {
          visited.add(adjKey);
          queue.push(adjKey);
        }
        const adjNeighbor = hexNeighbor(edgeNeighbor.q, edgeNeighbor.r, adjDir);
        const altKey = `${adjNeighbor.q},${adjNeighbor.r}:${OPPOSITE_DIRECTION[adjDir]}`;
        if (barrierEdges.has(altKey) && !visited.has(altKey)) {
          visited.add(altKey);
          queue.push(altKey);
        }
      }
    }
  }

  // Find island barriers
  const islandEdges = [...barrierEdges].filter((key) => !visited.has(key));

  return {
    connected: islandEdges.length === 0,
    islandCount: islandEdges.length,
    islandEdges,
  };
}

/**
 * Check if an edge touches the map boundary (is an anchor point for barriers)
 *
 * @param {Object} ctx - Context object with { hexes, realmRadius }
 * @param {number} q - Hex q coordinate
 * @param {number} r - Hex r coordinate
 * @param {string} direction - Direction to neighbor
 * @returns {boolean} True if edge touches the map boundary
 */
export function isEdgeAnchorPoint(ctx, q, r, direction) {
  const neighbor = hexNeighbor(q, r, direction);
  const neighborKey = hexKey(neighbor.q, neighbor.r);
  const neighborHex = ctx.hexes.get(neighborKey);

  // Edge is an anchor if it touches a border hex
  if (neighborHex && neighborHex.isBorder) {
    return true;
  }

  // Also anchor if the neighbor position is at/beyond realm boundary
  // (even if hex not generated yet - this ensures early barriers can anchor)
  if (ctx.realmRadius) {
    const neighborDist = hexDistance(0, 0, neighbor.q, neighbor.r);
    if (neighborDist >= ctx.realmRadius) {
      return true;
    }
  }

  return false;
}

/**
 * Check if an edge connects to an already-anchored barrier (shares a vertex)
 *
 * @param {Object} ctx - Context object with { anchoredBarrierEdges }
 * @param {number} q - Hex q coordinate
 * @param {number} r - Hex r coordinate
 * @param {string} direction - Direction to neighbor
 * @returns {boolean} True if edge connects to an anchored barrier
 */
export function isEdgeConnectedToAnchoredNetwork(ctx, q, r, direction) {
  if (!ctx.anchoredBarrierEdges || ctx.anchoredBarrierEdges.size === 0) {
    return false;
  }

  // Check adjacent edges on this hex (share vertices)
  const adjacentDirs = getAdjacentDirections(direction);
  for (const adjDir of adjacentDirs) {
    if (hasBarrierBetween(ctx.anchoredBarrierEdges, q, r, adjDir)) {
      return true;
    }
  }

  // Check adjacent edges on neighbor hex
  const neighbor = hexNeighbor(q, r, direction);
  const oppDir = OPPOSITE_DIRECTION[direction];
  const neighborAdjacentDirs = getAdjacentDirections(oppDir);
  for (const adjDir of neighborAdjacentDirs) {
    if (hasBarrierBetween(ctx.anchoredBarrierEdges, neighbor.q, neighbor.r, adjDir)) {
      return true;
    }
  }

  return false;
}

/**
 * Calculate feature weights for a hex based on current constraints
 *
 * @param {Object} ctx - Context object with { rng, constraints, canPlaceHolding }
 * @param {Object} hex - The hex object
 * @returns {Object} Map of feature type to weight
 */
export function calculateFeatureWeights(ctx, hex) {
  const exploredHexes = ctx.constraints.explorableHexes.count;
  const expectedTotalHexes = 144;
  const remainingHexes = Math.max(1, expectedTotalHexes - exploredHexes);

  const weights = { none: 1.0 };

  const progressRatio = exploredHexes / expectedTotalHexes;
  const catchUpMultiplier = 1 + Math.max(0, progressRatio - 0.5) * 3;

  // Holdings
  if (ctx.constraints.holdings.placed < ctx.constraints.holdings.target) {
    if (!ctx.canPlaceHolding || ctx.canPlaceHolding(hex)) {
      const remaining = ctx.constraints.holdings.target - ctx.constraints.holdings.placed;
      let prob = remaining / remainingHexes;
      prob *= 1.5; // Spacing constraint boost
      prob *= catchUpMultiplier;
      if (progressRatio > 0.7) {
        prob *= 2.5;
      }
      if (remainingHexes < remaining * 12) {
        prob *= 2;
      }
      if (remainingHexes < remaining * 6) {
        prob *= 2;
      }
      weights.holding = prob;
    }
  }

  // Myth Sites
  if (ctx.constraints.mythSites.placed < ctx.constraints.mythSites.target) {
    const remaining = ctx.constraints.mythSites.target - ctx.constraints.mythSites.placed;
    let prob = remaining / remainingHexes;
    prob *= catchUpMultiplier;
    if (progressRatio > 0.7) {
      prob *= 2;
    }
    if (remainingHexes < remaining * 8) {
      prob *= 3;
    }
    weights.mythSite = prob;
  }

  // Landmarks
  const landmarkTypes = ['curse', 'dwelling', 'hazard', 'monument', 'ruin', 'sanctum'];
  for (const type of landmarkTypes) {
    const constraint = ctx.constraints.landmarks[type];
    if (constraint.placed < constraint.max) {
      const targetMid = (constraint.min + constraint.max) / 2;
      const remaining = Math.max(0, targetMid - constraint.placed);
      let prob = remaining / remainingHexes;
      if (constraint.placed < constraint.min) {
        prob *= catchUpMultiplier;
        if (progressRatio > 0.7) {
          prob *= 2;
        }
        if (remainingHexes < (constraint.min - constraint.placed) * 10) {
          prob *= 2;
        }
      }
      weights[`landmark_${type}`] = prob;
    }
  }

  return weights;
}

/**
 * Maybe add a feature to a hex based on calculated weights
 *
 * @param {Object} ctx - Context object with { rng, constraints, features, hasExclusiveFeature, canPlaceExclusiveFeature, canPlaceHolding }
 * @param {Object} hex - The hex object
 * @returns {string|null} Placed feature type or null
 */
export function maybeAddFeature(ctx, hex) {
  if (hex.isBorder || hex.isLake) return null;
  if (hex.feature) return null;

  // Check centralized registry
  if (ctx.hasExclusiveFeature && ctx.hasExclusiveFeature(hex)) {
    return null;
  }

  const featureWeights = calculateFeatureWeights(ctx, hex);
  const features = Object.keys(featureWeights);
  const weights = Object.values(featureWeights);

  if (Math.max(...weights) === 0) return null;

  const totalWeight = weights.reduce((a, b) => a + b, 0);
  if (ctx.rng.next() > totalWeight) return null;

  const feature = ctx.rng.weightedChoice(features, weights);
  if (feature === 'none') return null;

  // Check feature exclusivity
  if (ctx.canPlaceExclusiveFeature && !ctx.canPlaceExclusiveFeature(hex)) {
    return null;
  }

  // Validate and place feature
  let placedFeature = false;
  if (feature === 'holding') {
    if (ctx.canPlaceHolding && !ctx.canPlaceHolding(hex)) return null;

    // Assign a unique holding type
    const usedTypes = ctx.constraints.holdings.usedTypes || [];
    const allTypes = [
      HOLDING_TYPES.CASTLE,
      HOLDING_TYPES.FORTRESS,
      HOLDING_TYPES.TOWER,
      HOLDING_TYPES.TOWN,
    ];
    const availableTypes = allTypes.filter((type) => !usedTypes.includes(type));

    if (availableTypes.length > 0) {
      const selectedType = ctx.rng.choice(availableTypes);
      hex.holdingType = selectedType;

      // Track used types
      if (!ctx.constraints.holdings.usedTypes) {
        ctx.constraints.holdings.usedTypes = [];
      }
      ctx.constraints.holdings.usedTypes.push(selectedType);
    }

    ctx.constraints.holdings.placed++;
    if (ctx.constraints.holdings.positions) {
      ctx.constraints.holdings.positions.push({ q: hex.q, r: hex.r });
    }
    placedFeature = true;
  } else if (feature === 'mythSite') {
    if (ctx.constraints.mythSites.placed >= 6) return null;
    ctx.constraints.mythSites.placed++;
    if (ctx.constraints.mythSites.positions) {
      ctx.constraints.mythSites.positions.push({ q: hex.q, r: hex.r });
    }
    placedFeature = true;
  } else if (feature.startsWith('landmark_')) {
    const type = feature.replace('landmark_', '');
    if (ctx.constraints.landmarks[type].placed >= ctx.constraints.landmarks[type].max) return null;
    ctx.constraints.landmarks[type].placed++;
    placedFeature = true;
  }

  hex.feature = feature;
  if (ctx.features) {
    ctx.features.set(hexKey(hex.q, hex.r), feature);
  }

  // Register in centralized registry
  if (placedFeature && ctx.constraints.featureRegistry) {
    const key = hexKey(hex.q, hex.r);
    ctx.constraints.featureRegistry.add(key);
  }

  return feature;
}

/**
 * Move explorer with priority-based selection
 *
 * @param {Object} ctx - Context object with { rng, getValidMoves, exploreHex, currentExplorerPos, riverEdges, exploredHexes, findPathToUnexplored }
 * @returns {Object|null} Chosen move object or null if no moves available
 */
export function moveExplorer(ctx, getValidMoves, exploreHex) {
  const validMoves = getValidMoves();
  if (validMoves.length === 0) {
    return null;
  }

  let chosenMove;

  // Categorize moves
  const unexplored = validMoves.filter((m) => !ctx.exploredHexes.has(m.key));
  const unexploredWithFeatures = unexplored.filter((m) => m.hex && m.hex.feature);

  // Collect river frontier hexes
  const riverFrontierKeys = new Set();
  if (ctx.riverEdges) {
    for (const [, edge] of ctx.riverEdges) {
      const destHex = hexNeighbor(edge.hex1.q, edge.hex1.r, edge.direction);
      const destKey = hexKey(destHex.q, destHex.r);
      if (!ctx.exploredHexes.has(destKey)) {
        riverFrontierKeys.add(destKey);
      }
    }
  }
  const unexploredRiverFrontiers = unexplored.filter((m) => riverFrontierKeys.has(m.key));

  // Priority 0: River frontier (80%)
  if (unexploredRiverFrontiers.length > 0 && ctx.rng.next() < 0.8) {
    chosenMove = ctx.rng.choice(unexploredRiverFrontiers);
  }
  // Priority 1: Unexplored with feature (98%)
  else if (unexploredWithFeatures.length > 0 && ctx.rng.next() < 0.98) {
    chosenMove = ctx.rng.choice(unexploredWithFeatures);
  }
  // Priority 2: Any unexplored (98%)
  else if (unexplored.length > 0 && ctx.rng.next() < 0.98) {
    chosenMove = ctx.rng.choice(unexplored);
  }
  // Priority 3: Pathfinding
  else {
    const pathToUnexplored = ctx.findPathToUnexplored ? ctx.findPathToUnexplored() : null;

    if (pathToUnexplored && pathToUnexplored.length > 0) {
      const nextStep = pathToUnexplored[0];
      const nextKey = hexKey(nextStep.q, nextStep.r);

      const pathMove = validMoves.find((m) => m.key === nextKey);
      if (pathMove) {
        // 85% follow path, 15% explore differently
        if (ctx.rng.next() < 0.85) {
          chosenMove = pathMove;
        } else {
          const alternates = validMoves.filter((m) => m.key !== nextKey);
          if (alternates.length > 0) {
            chosenMove = ctx.rng.choice(alternates);
          } else {
            chosenMove = pathMove;
          }
        }
      } else {
        chosenMove = ctx.rng.choice(validMoves);
      }
    } else {
      chosenMove = ctx.rng.choice(validMoves);
    }
  }

  return chosenMove;
}

/**
 * Check if a border hex can reach the outer edge via borders or unrevealed hexes
 * @param {Object} ctx - Context { hexes, borderHexes, realmRadius, revealedHexes }
 * @param {string} borderKey - The border hex to check
 * @param {string|null} excludeKey - Hex to exclude from paths (being revealed)
 * @param {string|null} forceAsBorder - Treat this key as a border for path checking
 * @returns {boolean}
 */
export function canBorderReachOuterEdge(ctx, borderKey, excludeKey = null, forceAsBorder = null) {
  const { hexes, borderHexes, realmRadius, revealedHexes } = ctx;
  const outerThreshold = realmRadius + 1;

  const visited = new Set([borderKey]);
  const queue = [borderKey];

  while (queue.length > 0) {
    const currentKey = queue.shift();
    const { q, r } = parseHexKey(currentKey);
    const dist = hexDistance(0, 0, q, r);

    // Reached outer edge?
    if (dist >= outerThreshold) {
      return true;
    }

    const neighbors = hexNeighbors(q, r);
    for (const n of neighbors) {
      const nKey = hexKey(n.q, n.r);
      if (visited.has(nKey) || nKey === excludeKey) continue;
      visited.add(nKey);

      // Can traverse via: border hex, forced-as-border hex, or unrevealed hex
      const isBorder = borderHexes.has(nKey) || nKey === forceAsBorder;
      const isUnrevealed = !revealedHexes || !revealedHexes.has(nKey);
      const hexExists = hexes.has(nKey);

      if (isBorder || !hexExists || isUnrevealed) {
        queue.push(nKey);
      }
    }
  }

  return false;
}

/**
 * Convert a non-border hex to a border hex
 */
function convertHexToBorder(ctx, q, r) {
  const key = hexKey(q, r);
  const hex = ctx.hexes.get(key);
  if (!hex) return;

  // Determine border type from neighbors (clustering)
  let borderType = 'wasteland';
  const neighbors = hexNeighbors(q, r);
  for (const n of neighbors) {
    const nHex = ctx.hexes.get(hexKey(n.q, n.r));
    if (nHex && nHex.isBorder && nHex.borderType) {
      borderType = nHex.borderType;
      break;
    }
  }

  hex.isBorder = true;
  hex.borderType = borderType;
  hex.terrain = borderType;
  hex.isLake = false;
  ctx.borderHexes.add(key);
}

/**
 * Convert a border hex back to normal terrain (cancel intrusion)
 */
function convertBorderToTerrain(ctx, q, r) {
  const key = hexKey(q, r);
  const hex = ctx.hexes.get(key);
  if (!hex) return;

  hex.isBorder = false;
  hex.borderType = null;
  hex.terrain = 'plains'; // Will be regenerated
  ctx.borderHexes.delete(key);
}

/**
 * Ensure border connectivity when revealing a hex.
 * Returns action taken: 'ok' | 'forced' | 'cancelled'
 *
 * @param {Object} ctx - Context with hexes, borderHexes, realmRadius, revealedHexes, rng
 * @param {number} q - Hex q coordinate being revealed
 * @param {number} r - Hex r coordinate being revealed
 * @returns {{ action: string, affectedBorders?: string[], cancelledBorders?: string[] }}
 */
export function ensureBorderConnectivity(ctx, q, r) {
  const key = hexKey(q, r);
  const hex = ctx.hexes.get(key);

  // Only check for non-border hexes
  if (!hex || hex.isBorder) {
    return { action: 'ok' };
  }

  const neighbors = hexNeighbors(q, r);
  let needsForcing = false;
  const bordersToCancel = [];

  // First pass: identify which borders need fixing
  for (const n of neighbors) {
    const nKey = hexKey(n.q, n.r);
    if (!ctx.borderHexes.has(nKey)) continue;

    // Check if this border neighbor can reach outer edge without this hex
    if (canBorderReachOuterEdge(ctx, nKey, key, null)) {
      continue; // Border is connected, no problem
    }

    // Border would be islanded. Can we fix by forcing this hex to be a border?
    if (canBorderReachOuterEdge(ctx, nKey, null, key)) {
      needsForcing = true;
    } else {
      // No path even if we force this hex - must cancel the intrusion
      bordersToCancel.push({ q: n.q, r: n.r, key: nKey });
    }
  }

  // Cancel unfixable intrusions first
  for (const border of bordersToCancel) {
    convertBorderToTerrain(ctx, border.q, border.r);
  }

  // Force this hex to border if any remaining borders need it
  if (needsForcing) {
    convertHexToBorder(ctx, q, r);
    return { action: 'forced' };
  }

  if (bordersToCancel.length > 0) {
    return { action: 'cancelled', cancelledBorders: bordersToCancel.map((b) => b.key) };
  }

  return { action: 'ok' };
}

/**
 * Force complete missing hard constraint features
 *
 * @param {Object} ctx - Context object with { rng, hexes, exploredHexes, constraints, features, hasExclusiveFeature, canPlaceHolding }
 */
export function forceCompleteFeatures(ctx) {
  // Get all valid hexes
  const validHexes = [];
  for (const key of ctx.exploredHexes) {
    const hex = ctx.hexes.get(key);
    if (
      hex &&
      !hex.isBorder &&
      !hex.isLake &&
      (!ctx.hasExclusiveFeature || !ctx.hasExclusiveFeature(hex))
    ) {
      validHexes.push(hex);
    }
  }

  // Shuffle using seeded RNG
  for (let i = validHexes.length - 1; i > 0; i--) {
    const j = Math.floor(ctx.rng.next() * (i + 1));
    [validHexes[i], validHexes[j]] = [validHexes[j], validHexes[i]];
  }

  // Force place myth sites
  while (ctx.constraints.mythSites.placed < 6 && validHexes.length > 0) {
    const hex = validHexes.pop();
    if (!hex.feature && (!ctx.hasExclusiveFeature || !ctx.hasExclusiveFeature(hex))) {
      hex.feature = 'mythSite';
      if (ctx.features) {
        ctx.features.set(hexKey(hex.q, hex.r), 'mythSite');
      }
      ctx.constraints.mythSites.placed++;
      if (ctx.constraints.mythSites.positions) {
        ctx.constraints.mythSites.positions.push({ q: hex.q, r: hex.r });
      }
      if (ctx.constraints.featureRegistry) {
        ctx.constraints.featureRegistry.add(hexKey(hex.q, hex.r));
      }
    }
  }

  // Force place holdings
  while (ctx.constraints.holdings.placed < 4 && validHexes.length > 0) {
    const hex = validHexes.pop();
    if (
      !hex.feature &&
      (!ctx.hasExclusiveFeature || !ctx.hasExclusiveFeature(hex)) &&
      (!ctx.canPlaceHolding || ctx.canPlaceHolding(hex))
    ) {
      hex.feature = 'holding';

      // Assign a unique holding type
      const usedTypes = ctx.constraints.holdings.usedTypes || [];
      const allTypes = [
        HOLDING_TYPES.CASTLE,
        HOLDING_TYPES.FORTRESS,
        HOLDING_TYPES.TOWER,
        HOLDING_TYPES.TOWN,
      ];
      const availableTypes = allTypes.filter((type) => !usedTypes.includes(type));

      if (availableTypes.length > 0) {
        const selectedType = ctx.rng.choice(availableTypes);
        hex.holdingType = selectedType;

        // Track used types
        if (!ctx.constraints.holdings.usedTypes) {
          ctx.constraints.holdings.usedTypes = [];
        }
        ctx.constraints.holdings.usedTypes.push(selectedType);
      }

      if (ctx.features) {
        ctx.features.set(hexKey(hex.q, hex.r), 'holding');
      }
      ctx.constraints.holdings.placed++;
      if (ctx.constraints.holdings.positions) {
        ctx.constraints.holdings.positions.push({ q: hex.q, r: hex.r });
      }
      if (ctx.constraints.featureRegistry) {
        ctx.constraints.featureRegistry.add(hexKey(hex.q, hex.r));
      }
    }
  }
}
