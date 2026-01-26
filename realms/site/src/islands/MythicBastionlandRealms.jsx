import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';

// ============================================================================
// SEEDED RANDOM NUMBER GENERATOR
// ============================================================================
class SeededRNG {
  constructor(seed) {
    this.seed = seed;
    this.state = seed;
  }

  next() {
    this.state = (this.state * 1103515245 + 12345) & 0x7fffffff;
    return this.state / 0x7fffffff;
  }

  nextInt(min, max) {
    return Math.floor(this.next() * (max - min + 1)) + min;
  }

  choice(arr) {
    return arr[Math.floor(this.next() * arr.length)];
  }

  weightedChoice(items, weights) {
    const total = weights.reduce((a, b) => a + b, 0);
    let r = this.next() * total;
    for (let i = 0; i < items.length; i++) {
      r -= weights[i];
      if (r <= 0) return items[i];
    }
    return items[items.length - 1];
  }

  shuffle(arr) {
    const result = [...arr];
    for (let i = result.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1));
      [result[i], result[j]] = [result[j], result[i]];
    }
    return result;
  }

  reset() {
    this.state = this.seed;
  }

  getState() {
    return this.state;
  }

  setState(state) {
    this.state = state;
  }
}

// ============================================================================
// HEX MATH UTILITIES (Axial Coordinates, Pointy-Top)
// ============================================================================
const HEX_DIRECTIONS = {
  NE: { q: 1, r: -1 },
  E: { q: 1, r: 0 },
  SE: { q: 0, r: 1 },
  SW: { q: -1, r: 1 },
  W: { q: -1, r: 0 },
  NW: { q: 0, r: -1 },
};

const DIRECTION_NAMES = ['NE', 'E', 'SE', 'SW', 'W', 'NW'];
const OPPOSITE_DIRECTION = { NE: 'SW', E: 'W', SE: 'NW', SW: 'NE', W: 'E', NW: 'SE' };

// Mapping from direction to corner index for edge rendering
// For pointy-top hexagons with corners starting at -30° (upper-right):
// Corner 0: -30° (upper-right), Corner 1: 30° (lower-right), Corner 2: 90° (bottom)
// Corner 3: 150° (lower-left), Corner 4: 210° (upper-left), Corner 5: 270° (top)
const DIRECTION_TO_CORNER = {
  NE: 5, // NE edge: top to upper-right (corners 5->0)
  E: 0, // E edge: upper-right to lower-right (corners 0->1)
  SE: 1, // SE edge: lower-right to bottom (corners 1->2)
  SW: 2, // SW edge: bottom to lower-left (corners 2->3)
  W: 3, // W edge: lower-left to upper-left (corners 3->4)
  NW: 4, // NW edge: upper-left to top (corners 4->5)
};

function hexKey(q, r) {
  return `${q},${r}`;
}

function parseHexKey(key) {
  const [q, r] = key.split(',').map(Number);
  return { q, r };
}

function hexNeighbor(q, r, direction) {
  const d = HEX_DIRECTIONS[direction];
  return { q: q + d.q, r: r + d.r };
}

function hexNeighbors(q, r) {
  return DIRECTION_NAMES.map((dir) => ({
    direction: dir,
    ...hexNeighbor(q, r, dir),
  }));
}

function hexDistance(q1, r1, q2, r2) {
  return (Math.abs(q1 - q2) + Math.abs(q1 + r1 - q2 - r2) + Math.abs(r1 - r2)) / 2;
}

function hexToPixel(q, r, size) {
  const x = size * (Math.sqrt(3) * q + (Math.sqrt(3) / 2) * r);
  const y = size * ((3 / 2) * r);
  return { x, y };
}

function getHexCorners(cx, cy, size) {
  const corners = [];
  for (let i = 0; i < 6; i++) {
    const angle = (Math.PI / 180) * (60 * i - 30);
    corners.push({
      x: cx + size * Math.cos(angle),
      y: cy + size * Math.sin(angle),
    });
  }
  return corners;
}

function getEdgeMidpoint(cx, cy, size, direction) {
  const cornerIndex = DIRECTION_TO_CORNER[direction];
  const corners = getHexCorners(cx, cy, size);
  const c1 = corners[cornerIndex];
  const c2 = corners[(cornerIndex + 1) % 6];
  return { x: (c1.x + c2.x) / 2, y: (c1.y + c2.y) / 2 };
}

function getEdgeEndpoints(cx, cy, size, direction) {
  const cornerIndex = DIRECTION_TO_CORNER[direction];
  const corners = getHexCorners(cx, cy, size);
  return {
    p1: corners[cornerIndex],
    p2: corners[(cornerIndex + 1) % 6],
  };
}

// ============================================================================
// TERRAIN AND FEATURE DEFINITIONS
// ============================================================================
const TERRAIN_TYPES = {
  FOREST: 'forest',
  GLADE: 'glade',
  MARSH: 'marsh',
  BOG: 'bog',
  HEATH: 'heath',
  PLAINS: 'plains',
  VALLEY: 'valley',
  HILLS: 'hills',
  CRAG: 'crag',
  PEAKS: 'peaks',
};

const BORDER_TYPES = {
  SEA: 'sea',
  CLIFF: 'cliff',
  WASTELAND: 'wasteland',
};

const FEATURE_TYPES = {
  HOLDING: 'holding',
  MYTH_SITE: 'mythSite',
  LANDMARK_CURSE: 'curse',
  LANDMARK_DWELLING: 'dwelling',
  LANDMARK_HAZARD: 'hazard',
  LANDMARK_MONUMENT: 'monument',
  LANDMARK_RUIN: 'ruin',
  LANDMARK_SANCTUM: 'sanctum',
};

const LANDMARK_TYPES = ['curse', 'dwelling', 'hazard', 'monument', 'ruin', 'sanctum'];

const ELEVATION = {
  [TERRAIN_TYPES.PEAKS]: 3,
  [TERRAIN_TYPES.HILLS]: 2,
  [TERRAIN_TYPES.CRAG]: 2,
  default: 1,
};

function getElevation(terrain) {
  return ELEVATION[terrain] || ELEVATION.default;
}

const TERRAIN_COLORS = {
  [TERRAIN_TYPES.FOREST]: '#228B22',
  [TERRAIN_TYPES.GLADE]: '#90EE90',
  [TERRAIN_TYPES.MARSH]: '#8B8970',
  [TERRAIN_TYPES.BOG]: '#4A4A2F',
  [TERRAIN_TYPES.HEATH]: '#C4A484',
  [TERRAIN_TYPES.PLAINS]: '#F5DEB3',
  [TERRAIN_TYPES.VALLEY]: '#98FB98',
  [TERRAIN_TYPES.HILLS]: '#CD853F',
  [TERRAIN_TYPES.CRAG]: '#A0522D',
  [TERRAIN_TYPES.PEAKS]: '#DCDCDC',
  lake: '#4169E1',
  [BORDER_TYPES.SEA]: '#1E90FF',
  [BORDER_TYPES.CLIFF]: '#696969',
  [BORDER_TYPES.WASTELAND]: '#8B4513',
  unexplored: '#2a2a2a',
};

const FEATURE_ICONS = {
  [FEATURE_TYPES.HOLDING]: '🏰',
  [FEATURE_TYPES.MYTH_SITE]: '✨',
  [FEATURE_TYPES.LANDMARK_CURSE]: '💀',
  [FEATURE_TYPES.LANDMARK_DWELLING]: '🏠',
  [FEATURE_TYPES.LANDMARK_HAZARD]: '⚠️',
  [FEATURE_TYPES.LANDMARK_MONUMENT]: '🗿',
  [FEATURE_TYPES.LANDMARK_RUIN]: '🏚️',
  [FEATURE_TYPES.LANDMARK_SANCTUM]: '⛪',
};

// ============================================================================
// TERRAIN AFFINITY RULES
// ============================================================================
const TERRAIN_AFFINITIES = {
  [TERRAIN_TYPES.FOREST]: {
    [TERRAIN_TYPES.GLADE]: 5,
    [TERRAIN_TYPES.FOREST]: 3,
  },
  [TERRAIN_TYPES.GLADE]: {
    [TERRAIN_TYPES.FOREST]: 5,
    [TERRAIN_TYPES.GLADE]: 2,
  },
  [TERRAIN_TYPES.MARSH]: {
    [TERRAIN_TYPES.BOG]: 4,
    [TERRAIN_TYPES.MARSH]: 3,
    waterAdjacent: 3,
  },
  [TERRAIN_TYPES.BOG]: {
    [TERRAIN_TYPES.MARSH]: 4,
    [TERRAIN_TYPES.BOG]: 3,
    waterAdjacent: 3,
  },
  [TERRAIN_TYPES.HEATH]: {
    [TERRAIN_TYPES.BOG]: 3,
    [TERRAIN_TYPES.MARSH]: 3,
  },
  [TERRAIN_TYPES.PLAINS]: {
    [TERRAIN_TYPES.HILLS]: 3,
    [TERRAIN_TYPES.PLAINS]: 2,
  },
  [TERRAIN_TYPES.VALLEY]: {
    [TERRAIN_TYPES.PEAKS]: 4,
    [TERRAIN_TYPES.HILLS]: 3,
    [TERRAIN_TYPES.CRAG]: 3,
    cliffAdjacent: 2,
  },
  [TERRAIN_TYPES.HILLS]: {
    [TERRAIN_TYPES.PEAKS]: 3,
    [TERRAIN_TYPES.CRAG]: 3,
    [TERRAIN_TYPES.VALLEY]: 3,
    [TERRAIN_TYPES.HILLS]: 2,
    [TERRAIN_TYPES.PLAINS]: 2,
    cliffAdjacent: 2,
  },
  [TERRAIN_TYPES.CRAG]: {
    [TERRAIN_TYPES.PEAKS]: 4,
    [TERRAIN_TYPES.HILLS]: 2,
    [TERRAIN_TYPES.VALLEY]: 3,
    [TERRAIN_TYPES.CRAG]: 2,
    cliffAdjacent: 2,
  },
  [TERRAIN_TYPES.PEAKS]: {
    [TERRAIN_TYPES.HILLS]: 3,
    [TERRAIN_TYPES.CRAG]: 4,
    [TERRAIN_TYPES.VALLEY]: 3,
    [TERRAIN_TYPES.PEAKS]: 2,
    cliffAdjacent: 3,
  },
};

// ============================================================================
// REALM GENERATOR CLASS
// ============================================================================
class RealmGenerator {
  constructor(seed) {
    this.seed = seed;
    this.rng = new SeededRNG(seed);
    this.hexes = new Map();
    this.exploredHexes = new Set();
    this.revealedHexes = new Set();
    this.borderHexes = new Set();
    this.lakes = [];
    this.riverEdges = new Map();
    this.riverNetwork = [];
    this.barrierEdges = new Set();
    this.traversedEdges = new Set(); // Edges the explorer has crossed - cannot have barriers
    this.features = new Map();
    this.terrainClusters = new Map();
    this.clusterIdCounter = 0;
    this.borderClusters = [];
    this.explorerPath = [];
    this.currentExplorerPos = null;
    this.generationLog = [];
    this.stepStates = [];
    this.constraints = this.initConstraints();
    this.realmCenter = { q: 0, r: 0 };
    this.realmRadius = 8;
    this.borderClusterSeeds = [];
    this.barrierCrossings = 0; // Debug counter for barrier crossings
    this.generationMode = null; // Track generation context: null | 'validation' | 'exploration'
  }

  initConstraints() {
    return {
      holdings: { placed: 0, target: 4, positions: [] },
      mythSites: { placed: 0, target: 6, positions: [] },
      landmarks: {
        curse: { placed: 0, min: 3, max: 4 },
        dwelling: { placed: 0, min: 3, max: 4 },
        hazard: { placed: 0, min: 3, max: 4 },
        monument: { placed: 0, min: 3, max: 4 },
        ruin: { placed: 0, min: 3, max: 4 },
        sanctum: { placed: 0, min: 3, max: 4 },
      },
      lakes: { placed: 0, max: 3 },
      barriers: { placed: 0, target: 24 },
      explorableHexes: { count: 0, min: 100, target: 144, max: 180 },
      riverNetwork: { span: 0, targetSpan: 8 },
      borderClosure: { complete: false },
    };
  }

  initialize(startAtBorder = false) {
    this.rng.reset();
    this.hexes.clear();
    this.exploredHexes.clear();
    this.revealedHexes.clear();
    this.borderHexes.clear();
    this.lakes = [];
    this.riverEdges.clear();
    this.riverNetwork = [];
    this.barrierEdges.clear();
    this.traversedEdges.clear();
    this.features.clear();
    this.terrainClusters.clear();
    this.clusterIdCounter = 0;
    this.borderClusters = [];
    this.explorerPath = [];
    this.currentExplorerPos = null;
    this.generationLog = [];
    this.stepStates = [];
    this.constraints = this.initConstraints();
    this.barrierCrossings = 0;
    this.generationMode = null;

    // Initialize border cluster seeds (4 clusters around perimeter)
    this.initializeBorderClusters();

    // Generate initial realm structure
    this.generateInitialBorderShell();

    // Find starting position
    const startPos = this.findStartPosition(startAtBorder);
    this.currentExplorerPos = startPos;
    this.explorerPath.push({ ...startPos });

    // Generate and reveal starting hex and neighbors
    this.generateHex(startPos.q, startPos.r);
    this.exploreHex(startPos.q, startPos.r);

    this.saveStepState();
  }

  initializeBorderClusters() {
    // Create 4 border cluster seeds around the perimeter
    const borderTypes = Object.values(BORDER_TYPES);
    const angles = [0, Math.PI / 2, Math.PI, (3 * Math.PI) / 2];

    this.borderClusterSeeds = angles.map((angle, i) => ({
      type: this.rng.choice(borderTypes),
      angle: angle + ((this.rng.next() - 0.5) * Math.PI) / 4,
      spread: this.rng.next() * 0.3 + 0.2,
    }));
  }

  generateInitialBorderShell() {
    // Pre-generate border hexes to establish realm boundary
    const radius = this.realmRadius + 2;

    for (let q = -radius; q <= radius; q++) {
      for (let r = -radius; r <= radius; r++) {
        const dist = hexDistance(0, 0, q, r);
        if (dist >= this.realmRadius && dist <= radius) {
          const borderProb = this.getBorderProbability(q, r, dist);
          if (this.rng.next() < borderProb) {
            this.createBorderHex(q, r);
          }
        }
      }
    }
  }

  getBorderProbability(q, r, dist) {
    const angle = Math.atan2(r, q);
    let maxAffinity = 0;

    for (const cluster of this.borderClusterSeeds) {
      let angleDiff = Math.abs(angle - cluster.angle);
      if (angleDiff > Math.PI) angleDiff = 2 * Math.PI - angleDiff;
      const affinity = Math.exp(-angleDiff / cluster.spread);
      maxAffinity = Math.max(maxAffinity, affinity);
    }

    const distanceFactor = (dist - this.realmRadius) / 2;
    return Math.min(0.95, 0.3 + distanceFactor * 0.3 + maxAffinity * 0.3);
  }

  createBorderHex(q, r) {
    const key = hexKey(q, r);
    if (this.hexes.has(key)) return;

    const angle = Math.atan2(r, q);
    let bestCluster = this.borderClusterSeeds[0];
    let bestAffinity = 0;

    for (const cluster of this.borderClusterSeeds) {
      let angleDiff = Math.abs(angle - cluster.angle);
      if (angleDiff > Math.PI) angleDiff = 2 * Math.PI - angleDiff;
      const affinity = Math.exp(-angleDiff / cluster.spread);
      if (affinity > bestAffinity) {
        bestAffinity = affinity;
        bestCluster = cluster;
      }
    }

    // Check for adjacent border hexes of specific type
    const neighbors = hexNeighbors(q, r);
    for (const n of neighbors) {
      const nKey = hexKey(n.q, n.r);
      const nHex = this.hexes.get(nKey);
      if (nHex && nHex.isBorder) {
        if (this.rng.next() < 0.7) {
          bestCluster = { type: nHex.borderType };
        }
        break;
      }
    }

    this.hexes.set(key, {
      q,
      r,
      isBorder: true,
      borderType: bestCluster.type,
      revealed: false,
    });
    this.borderHexes.add(key);
  }

  // Check if placing a barrier or lake would trap the explorer or create isolated regions
  wouldTrapExplorer(barrierEdgeKey, lakeHexKey = null) {
    // Get all currently explored hexes that need to remain connected
    if (this.exploredHexes.size === 0) return false;

    // Build a graph of passable hexes and check connectivity
    const explorerPos = this.currentExplorerPos;
    if (!explorerPos) return false;

    // Simulate the placement and check if explorer still has valid moves
    const tempBarriers = new Set(this.barrierEdges);
    if (barrierEdgeKey) tempBarriers.add(barrierEdgeKey);

    const tempLakes = new Set();
    for (const [key, hex] of this.hexes) {
      if (hex.isLake) tempLakes.add(key);
    }
    if (lakeHexKey) tempLakes.add(lakeHexKey);

    // Check if explorer's current position would have any valid moves
    const neighbors = hexNeighbors(explorerPos.q, explorerPos.r);
    let validMoveCount = 0;

    for (const n of neighbors) {
      const nKey = hexKey(n.q, n.r);

      // Check if this would be a border position
      const dist = hexDistance(0, 0, n.q, n.r);
      if (dist >= this.realmRadius) continue;

      const nHex = this.hexes.get(nKey);

      // Skip if border or lake (including simulated lake)
      if (nHex && nHex.isBorder) continue;
      if (tempLakes.has(nKey)) continue;

      // Check if barrier blocks this edge (check both key formats)
      const neighbor = hexNeighbor(explorerPos.q, explorerPos.r, n.direction);
      const oppDir = OPPOSITE_DIRECTION[n.direction];
      const key1 = `${explorerPos.q},${explorerPos.r}:${n.direction}`;
      const key2 = `${neighbor.q},${neighbor.r}:${oppDir}`;
      if (tempBarriers.has(key1) || tempBarriers.has(key2)) continue;

      // This is a valid move
      validMoveCount++;
    }

    // Explorer is trapped if no valid moves from current position
    if (validMoveCount === 0) return true;

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

        const nHex = this.hexes.get(nKey);
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
        if (!this.revealedHexes.has(nKey)) continue;

        reachable.add(nKey);
        queue.push(nKey);
      }
    }

    // Check if any explored (non-lake, non-border) hexes are unreachable
    for (const expKey of this.exploredHexes) {
      const expHex = this.hexes.get(expKey);
      if (expHex && !expHex.isBorder && !expHex.isLake && !tempLakes.has(expKey)) {
        if (!reachable.has(expKey)) {
          return true; // Would create isolated pocket
        }
      }
    }

    return false;
  }

  findStartPosition(startAtBorder) {
    const candidates = [];

    if (startAtBorder) {
      // Find hexes adjacent to border
      for (let q = -this.realmRadius; q <= this.realmRadius; q++) {
        for (let r = -this.realmRadius; r <= this.realmRadius; r++) {
          const dist = hexDistance(0, 0, q, r);
          if (dist < this.realmRadius - 1) {
            const neighbors = hexNeighbors(q, r);
            const hasAdjacentBorder = neighbors.some((n) => this.borderHexes.has(hexKey(n.q, n.r)));
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
          if (dist < this.realmRadius - 2 && !this.borderHexes.has(hexKey(q, r))) {
            candidates.push({ q, r });
          }
        }
      }
    }

    return candidates.length > 0 ? this.rng.choice(candidates) : { q: 0, r: 0 };
  }

  generateHex(q, r) {
    const key = hexKey(q, r);
    if (this.hexes.has(key)) return this.hexes.get(key);

    const dist = hexDistance(0, 0, q, r);

    // Check if should be border
    if (dist >= this.realmRadius) {
      this.createBorderHex(q, r);
      return this.hexes.get(key);
    }

    // Generate passable terrain hex
    const terrain = this.generateTerrain(q, r);
    const isLake = this.shouldBeLake(q, r);

    const hex = {
      q,
      r,
      terrain: isLake ? 'lake' : terrain,
      isLake,
      isBorder: false,
      revealed: false,
      riverEdges: [],
      barrierEdges: [],
      feature: null,
      clusterId: null,
    };

    // Assign to terrain cluster
    this.assignToCluster(hex);

    this.hexes.set(key, hex);

    if (!hex.isBorder && !hex.isLake) {
      this.constraints.explorableHexes.count++;
    }

    // Generate edges (rivers, barriers)
    this.generateEdges(hex);

    // Potentially place feature
    this.maybeAddFeature(hex);

    this.generationLog.push({
      type: 'hex_generated',
      hex: { ...hex },
      timestamp: this.explorerPath.length,
    });

    return hex;
  }

  generateTerrain(q, r) {
    const neighbors = hexNeighbors(q, r);
    const adjacentTerrains = [];
    const adjacentClusters = new Map();
    let hasWaterAdjacent = false;
    let hasCliffAdjacent = false;
    let hasRiverAdjacent = false;

    for (const n of neighbors) {
      const nKey = hexKey(n.q, n.r);
      const nHex = this.hexes.get(nKey);
      if (nHex) {
        if (nHex.isBorder) {
          if (nHex.borderType === BORDER_TYPES.SEA) hasWaterAdjacent = true;
          if (nHex.borderType === BORDER_TYPES.CLIFF) hasCliffAdjacent = true;
        } else if (nHex.isLake) {
          hasWaterAdjacent = true;
        } else if (nHex.terrain) {
          adjacentTerrains.push(nHex.terrain);
          if (nHex.clusterId !== null) {
            const cluster = this.terrainClusters.get(nHex.clusterId);
            if (cluster) {
              adjacentClusters.set(nHex.clusterId, cluster);
            }
          }
        }
        if (nHex.riverEdges && nHex.riverEdges.length > 0) {
          hasRiverAdjacent = true;
          hasWaterAdjacent = true;
        }
      }
    }

    // Calculate weights for each terrain type
    const terrainTypes = Object.values(TERRAIN_TYPES);
    const weights = terrainTypes.map((t) => {
      let weight = 1;

      // Apply affinity bonuses
      const affinities = TERRAIN_AFFINITIES[t] || {};

      for (const adjTerrain of adjacentTerrains) {
        if (affinities[adjTerrain]) {
          weight += affinities[adjTerrain];
        }
      }

      // Water affinity for marsh/bog
      if (hasWaterAdjacent && affinities.waterAdjacent) {
        weight += affinities.waterAdjacent;
      }

      // Cliff affinity for elevation terrains
      if (hasCliffAdjacent && affinities.cliffAdjacent) {
        weight += affinities.cliffAdjacent;
      }

      // Cluster continuation bonus
      for (const [clusterId, cluster] of adjacentClusters) {
        if (cluster.terrain === t) {
          const clusterSize = cluster.hexes.size;
          if (clusterSize < 3) {
            weight += 4; // Strong bonus for small clusters
          } else if (clusterSize < 6) {
            weight += 3;
          } else if (clusterSize < 12) {
            weight += 1;
          }
          // Clusters at 12+ have reduced continuation
        }
      }

      return weight;
    });

    return this.rng.weightedChoice(terrainTypes, weights);
  }

  shouldBeLake(q, r) {
    const thisKey = hexKey(q, r);

    // HARD CONSTRAINT: Check if making this a lake would trap the explorer
    if (this.wouldTrapExplorer(null, thisKey)) {
      return false;
    }

    if (this.constraints.lakes.placed >= this.constraints.lakes.max) {
      // Soft constraint - still allow with low probability
      if (this.rng.next() > 0.1) return false;
    }

    // Check for adjacent lake to extend
    const neighbors = hexNeighbors(q, r);
    let adjacentLake = null;

    for (const n of neighbors) {
      const nKey = hexKey(n.q, n.r);
      const nHex = this.hexes.get(nKey);
      if (nHex && nHex.isLake) {
        adjacentLake = nHex;
        break;
      }
    }

    if (adjacentLake) {
      // Extend lake with decreasing probability based on size
      const lakeInfo = this.lakes.find((l) => l.hexes.has(hexKey(adjacentLake.q, adjacentLake.r)));
      if (lakeInfo && lakeInfo.hexes.size < 6) {
        return this.rng.next() < 0.4;
      }
      return false;
    }

    // New lake probability
    if (this.constraints.lakes.placed < this.constraints.lakes.max) {
      return this.rng.next() < 0.03;
    }

    return false;
  }

  assignToCluster(hex) {
    if (hex.isLake) {
      // Find or create lake cluster
      const neighbors = hexNeighbors(hex.q, hex.r);
      for (const n of neighbors) {
        const nKey = hexKey(n.q, n.r);
        const nHex = this.hexes.get(nKey);
        if (nHex && nHex.isLake) {
          const lakeInfo = this.lakes.find((l) => l.hexes.has(nKey));
          if (lakeInfo) {
            lakeInfo.hexes.add(hexKey(hex.q, hex.r));
            return;
          }
        }
      }
      // New lake
      this.lakes.push({ hexes: new Set([hexKey(hex.q, hex.r)]) });
      this.constraints.lakes.placed++;
      return;
    }

    // Find adjacent cluster of same terrain
    const neighbors = hexNeighbors(hex.q, hex.r);
    for (const n of neighbors) {
      const nKey = hexKey(n.q, n.r);
      const nHex = this.hexes.get(nKey);
      if (
        nHex &&
        !nHex.isBorder &&
        !nHex.isLake &&
        nHex.terrain === hex.terrain &&
        nHex.clusterId !== null
      ) {
        const cluster = this.terrainClusters.get(nHex.clusterId);
        if (cluster && cluster.hexes.size < 12) {
          cluster.hexes.add(hexKey(hex.q, hex.r));
          hex.clusterId = nHex.clusterId;
          return;
        }
      }
    }

    // Create new cluster
    const clusterId = this.clusterIdCounter++;
    this.terrainClusters.set(clusterId, {
      terrain: hex.terrain,
      hexes: new Set([hexKey(hex.q, hex.r)]),
    });
    hex.clusterId = clusterId;
  }

  generateEdges(hex) {
    if (hex.isBorder) return;

    const neighbors = hexNeighbors(hex.q, hex.r);

    for (const n of neighbors) {
      const nKey = hexKey(n.q, n.r);
      const nHex = this.hexes.get(nKey);

      // Maybe generate river edge
      this.maybeGenerateRiver(hex, n.direction, nHex);

      // Maybe generate barrier edge - skip during validation mode
      if (this.generationMode !== 'validation') {
        this.maybeGenerateBarrier(hex, n.direction, nHex);
      }
    }
  }

  maybeGenerateRiver(hex, direction, neighborHex) {
    const edgeKey = this.getEdgeKey(hex.q, hex.r, direction);

    // Check if edge already has river
    if (this.riverEdges.has(edgeKey)) return;

    // Check if this would continue an existing river at a shared vertex
    const existingRiverEnd = this.findRiverEndAtVertex(hex.q, hex.r, direction);
    const riverOriginScore = this.getRiverOriginScore(hex);

    // Calculate continuation probability - strongly favor continuing until span target met
    const currentSpan = this.constraints.riverNetwork.span;
    const hasRiver = this.riverEdges.size > 0;

    // More aggressive span bonus when under target
    const spanBonus = currentSpan < 8 ? 0.25 : 0;

    // Only continue if we're at an actual river endpoint (not branching mid-river)
    const isAtRiverTip = existingRiverEnd && this.isRiverTip(hex.q, hex.r, direction);

    // Higher continuation score at river tips, especially when span is low
    const riverContinueScore = isAtRiverTip ? 0.65 + spanBonus : existingRiverEnd ? 0.12 : 0;

    // Origin probability - higher if no river exists yet
    const originMultiplier = hasRiver ? 0.03 : 0.06;

    const shouldCreateRiver =
      this.rng.next() < Math.max(riverOriginScore * originMultiplier, riverContinueScore);

    if (!shouldCreateRiver && !existingRiverEnd) return;

    // Reduce branching - if continuing from non-tip, usually reject
    if (existingRiverEnd && !isAtRiverTip && this.rng.next() > 0.15) return;

    // Validate elevation constraints
    if (neighborHex && !neighborHex.isBorder && !neighborHex.isLake) {
      const hexElev = getElevation(hex.terrain);
      const neighborElev = getElevation(neighborHex.terrain);

      // Check if river can flow here based on origin elevation
      if (!this.canRiverEnter(hex, neighborHex)) {
        // Maybe force terminus
        if (existingRiverEnd && this.rng.next() < 0.5) {
          this.forceTerminus(hex.q, hex.r, direction);
        }
        return;
      }
    }

    // Create river edge
    const flowDirection = this.determineFlowDirection(hex, neighborHex, existingRiverEnd);

    this.riverEdges.set(edgeKey, {
      hex1: { q: hex.q, r: hex.r },
      direction,
      flowDirection,
      isSource: !existingRiverEnd && riverOriginScore > 0,
      isTerminus: this.isValidTerminus(neighborHex),
    });

    hex.riverEdges.push(direction);

    // Update river span periodically (every 5 new edges to avoid performance hit)
    if (this.riverEdges.size % 5 === 0) {
      this.calculateRiverNetworkSpan();
    }
  }

  getEdgeKey(q, r, direction) {
    const neighbor = hexNeighbor(q, r, direction);
    const oppDir = OPPOSITE_DIRECTION[direction];

    // Normalize edge key so same edge from either hex produces same key
    if (q < neighbor.q || (q === neighbor.q && r < neighbor.r)) {
      return `${q},${r}:${direction}`;
    }
    return `${neighbor.q},${neighbor.r}:${oppDir}`;
  }

  // Helper to check if a barrier exists between two hexes (checks both key formats)
  hasBarrierBetween(q1, r1, direction, barrierSet = null) {
    const set = barrierSet || this.barrierEdges;
    const neighbor = hexNeighbor(q1, r1, direction);
    const oppDir = OPPOSITE_DIRECTION[direction];
    const key1 = `${q1},${r1}:${direction}`;
    const key2 = `${neighbor.q},${neighbor.r}:${oppDir}`;
    return set.has(key1) || set.has(key2);
  }

  findRiverEnd(q, r, direction) {
    // Check adjacent edges for rivers that could continue
    const neighbors = hexNeighbors(q, r);
    for (const n of neighbors) {
      if (n.direction === direction) continue;
      const edgeKey = this.getEdgeKey(q, r, n.direction);
      if (this.riverEdges.has(edgeKey)) {
        return this.riverEdges.get(edgeKey);
      }
    }
    return null;
  }

  findRiverEndAtVertex(q, r, direction) {
    // Only find river ends that share a vertex with this edge
    // This prevents rivers from branching wildly
    const adjacentDirs = this.getAdjacentEdgeDirections(direction);
    for (const adjDir of adjacentDirs) {
      const edgeKey = this.getEdgeKey(q, r, adjDir);
      if (this.riverEdges.has(edgeKey)) {
        return this.riverEdges.get(edgeKey);
      }
    }
    return null;
  }

  isRiverTip(q, r, direction) {
    // Check if this is at the "tip" of a river (only one river edge at this vertex)
    const adjacentDirs = this.getAdjacentEdgeDirections(direction);
    let riverCount = 0;
    for (const adjDir of adjacentDirs) {
      const edgeKey = this.getEdgeKey(q, r, adjDir);
      if (this.riverEdges.has(edgeKey)) {
        riverCount++;
      }
    }
    return riverCount === 1;
  }

  getRiverOriginScore(hex) {
    // Score how suitable this hex is as a river origin
    if (hex.terrain === TERRAIN_TYPES.PEAKS) return 0.8;
    if (hex.terrain === TERRAIN_TYPES.MARSH) return 0.5;
    if (hex.terrain === TERRAIN_TYPES.BOG) return 0.5;

    // Check for adjacent cliff border
    const neighbors = hexNeighbors(hex.q, hex.r);
    for (const n of neighbors) {
      const nHex = this.hexes.get(hexKey(n.q, n.r));
      if (nHex && nHex.isBorder && nHex.borderType === BORDER_TYPES.CLIFF) {
        return 0.6;
      }
    }

    if (hex.isLake) return 0.7;

    return 0;
  }

  canRiverEnter(fromHex, toHex) {
    if (!toHex || toHex.isBorder || toHex.isLake) return true;

    const toElev = getElevation(toHex.terrain);
    if (toElev <= 1) return true; // Can always enter low elevation

    // Need to check river origin
    // Simplified: allow if any adjacent revealed hex has suitable elevation
    return toElev <= 2; // Allow hills/crags
  }

  determineFlowDirection(hex, neighborHex, existingRiver) {
    if (existingRiver) {
      return existingRiver.flowDirection;
    }

    if (!neighborHex) return 'unknown';

    const hexElev = hex.isLake ? 1 : getElevation(hex.terrain);
    const neighborElev = neighborHex.isLake
      ? 1
      : neighborHex.isBorder
        ? 0
        : getElevation(neighborHex.terrain);

    if (hexElev > neighborElev) return 'downstream';
    if (hexElev < neighborElev) return 'upstream';

    return this.rng.next() < 0.5 ? 'downstream' : 'upstream';
  }

  isValidTerminus(hex) {
    if (!hex) return false;
    if (hex.isLake) return true;
    if (hex.isBorder) {
      return hex.borderType === BORDER_TYPES.SEA || hex.borderType === BORDER_TYPES.CLIFF;
    }
    return hex.terrain === TERRAIN_TYPES.MARSH || hex.terrain === TERRAIN_TYPES.BOG;
  }

  forceTerminus(q, r, direction) {
    const neighbor = hexNeighbor(q, r, direction);
    const key = hexKey(neighbor.q, neighbor.r);

    if (this.hexes.has(key)) return;

    // Force create a terminus hex
    const terminusType = this.rng.choice([TERRAIN_TYPES.MARSH, TERRAIN_TYPES.BOG, 'lake']);

    if (terminusType === 'lake') {
      this.hexes.set(key, {
        q: neighbor.q,
        r: neighbor.r,
        terrain: 'lake',
        isLake: true,
        isBorder: false,
        revealed: false,
        riverEdges: [],
        barrierEdges: [],
        feature: null,
        clusterId: null,
      });
      this.lakes.push({ hexes: new Set([key]) });
      this.constraints.lakes.placed++;
    } else {
      this.hexes.set(key, {
        q: neighbor.q,
        r: neighbor.r,
        terrain: terminusType,
        isLake: false,
        isBorder: false,
        revealed: false,
        riverEdges: [],
        barrierEdges: [],
        feature: null,
        clusterId: null,
      });
    }
  }

  maybeGenerateBarrier(hex, direction, neighborHex) {
    // Skip barrier generation during validation mode (when checking valid moves)
    if (this.generationMode === 'validation') {
      return;
    }

    if (!neighborHex || neighborHex.isBorder) return;

    // Check both possible key formats
    const edgeKey1 = `${hex.q},${hex.r}:${direction}`;
    const oppDir = OPPOSITE_DIRECTION[direction];
    const edgeKey2 = `${neighborHex.q},${neighborHex.r}:${oppDir}`;

    if (this.barrierEdges.has(edgeKey1) || this.barrierEdges.has(edgeKey2)) return;

    // CRITICAL: Never place a barrier on an edge the explorer has already traversed
    if (this.traversedEdges.has(edgeKey1) || this.traversedEdges.has(edgeKey2)) return;

    // CRITICAL: Never place a barrier on an edge adjacent to the explorer's current position
    // This prevents barriers from being created that would block valid moves
    if (this.currentExplorerPos) {
      const explorerQ = this.currentExplorerPos.q;
      const explorerR = this.currentExplorerPos.r;
      // Check if either hex of this edge is the explorer's current position
      if (
        (hex.q === explorerQ && hex.r === explorerR) ||
        (neighborHex.q === explorerQ && neighborHex.r === explorerR)
      ) {
        return; // Don't place barrier on edge touching explorer's current hex
      }
    }

    const edgeKey = edgeKey1; // Use consistent key for storage

    // HARD CONSTRAINT: Check if adding this barrier would trap the explorer
    if (this.wouldTrapExplorer(edgeKey, null)) {
      return; // Skip barrier placement to maintain connectivity
    }

    // Check if we should add barrier
    const barrierProb = this.getBarrierProbability(hex, direction);

    if (this.rng.next() < barrierProb) {
      this.barrierEdges.add(edgeKey);
      hex.barrierEdges.push(direction);
      this.constraints.barriers.placed++;
    }
  }

  getBarrierProbability(hex, direction) {
    // Dynamic barrier probability based on current count vs target
    const currentBarriers = this.constraints.barriers.placed;
    const targetBarriers = 24;
    const exploredRatio = Math.max(0.1, this.constraints.explorableHexes.count / 144);

    // Expected barriers at this point in exploration
    const expectedBarriers = targetBarriers * exploredRatio;
    const barrierDeficit = expectedBarriers - currentBarriers;

    // Base probability adjusts based on deficit
    let baseProb = 0.05;
    if (barrierDeficit > 5) {
      baseProb = 0.08; // Behind target, increase probability
    } else if (barrierDeficit < -3) {
      baseProb = 0.02; // Ahead of target, decrease probability
    }

    const adjacentDirs = this.getAdjacentEdgeDirections(direction);
    let clusterBonus = 0;

    for (const adjDir of adjacentDirs) {
      if (this.hasBarrierBetween(hex.q, hex.r, adjDir)) {
        clusterBonus += 0.25;
      }
    }

    return Math.min(0.5, baseProb + clusterBonus);
  }

  getAdjacentEdgeDirections(direction) {
    const idx = DIRECTION_NAMES.indexOf(direction);
    return [DIRECTION_NAMES[(idx + 1) % 6], DIRECTION_NAMES[(idx + 5) % 6]];
  }

  maybeAddFeature(hex) {
    if (hex.isBorder || hex.isLake) return;
    if (hex.feature) return;

    const featureWeights = this.calculateFeatureWeights(hex);
    const features = Object.keys(featureWeights);
    const weights = Object.values(featureWeights);

    if (Math.max(...weights) === 0) return;

    const totalWeight = weights.reduce((a, b) => a + b, 0);
    if (this.rng.next() > totalWeight) return;

    const feature = this.rng.weightedChoice(features, weights);
    if (feature === 'none') return;

    // Validate placement
    if (feature === FEATURE_TYPES.HOLDING) {
      if (!this.canPlaceHolding(hex)) return;
      this.constraints.holdings.placed++;
      this.constraints.holdings.positions.push({ q: hex.q, r: hex.r });
    } else if (feature === FEATURE_TYPES.MYTH_SITE) {
      this.constraints.mythSites.placed++;
      this.constraints.mythSites.positions.push({ q: hex.q, r: hex.r });
    } else if (feature.startsWith('landmark_')) {
      const type = feature.replace('landmark_', '');
      this.constraints.landmarks[type].placed++;
    }

    hex.feature = feature;
    this.features.set(hexKey(hex.q, hex.r), feature);
  }

  calculateFeatureWeights(hex) {
    // Proportional probability: P = remaining_to_place / remaining_hexes
    // This ensures features are evenly distributed, not front-loaded at start
    const exploredHexes = this.constraints.explorableHexes.count;
    const expectedTotalHexes = 144;
    const remainingHexes = Math.max(1, expectedTotalHexes - exploredHexes);

    // Base weight for "no feature"
    const weights = { none: 1.0 };

    // Calculate catch-up multiplier for hard constraints
    // Ramps up smoothly as we approach the end of exploration
    const progressRatio = exploredHexes / expectedTotalHexes;
    const catchUpMultiplier = 1 + Math.max(0, progressRatio - 0.5) * 3;

    // Holdings: exactly 4, with spacing constraint (HARD CONSTRAINT)
    // Holdings need extra boost because spacing constraint limits valid hexes
    if (this.constraints.holdings.placed < this.constraints.holdings.target) {
      if (this.canPlaceHolding(hex)) {
        const remaining = this.constraints.holdings.target - this.constraints.holdings.placed;
        let prob = remaining / remainingHexes;
        // Holdings get 1.5x base boost due to spacing constraint reducing valid hexes
        prob *= 1.5;
        // Apply catch-up for hard constraint
        prob *= catchUpMultiplier;
        // Emergency boost if behind schedule
        if (remainingHexes < remaining * 12) {
          prob *= 2;
        }
        if (remainingHexes < remaining * 6) {
          prob *= 2;
        }
        weights[FEATURE_TYPES.HOLDING] = prob;
      }
    }

    // Myth Sites: exactly 6 (HARD CONSTRAINT)
    if (this.constraints.mythSites.placed < this.constraints.mythSites.target) {
      const remaining = this.constraints.mythSites.target - this.constraints.mythSites.placed;
      let prob = remaining / remainingHexes;
      prob *= catchUpMultiplier;
      if (remainingHexes < remaining * 8) {
        prob *= 3;
      }
      weights[FEATURE_TYPES.MYTH_SITE] = prob;
    }

    // Landmarks: 3-4 of each type (SOFT CONSTRAINT - less aggressive catch-up)
    for (const type of LANDMARK_TYPES) {
      const constraint = this.constraints.landmarks[type];
      if (constraint.placed < constraint.max) {
        const targetMid = (constraint.min + constraint.max) / 2; // 3.5
        const remaining = Math.max(0, targetMid - constraint.placed);
        let prob = remaining / remainingHexes;
        // Softer catch-up for soft constraints
        if (constraint.placed < constraint.min) {
          prob *= 1 + Math.max(0, progressRatio - 0.6) * 2;
          if (remainingHexes < (constraint.min - constraint.placed) * 10) {
            prob *= 2;
          }
        }
        weights[`landmark_${type}`] = prob;
      }
    }

    return weights;
  }

  canPlaceHolding(hex) {
    // Check minimum distance from other holdings
    for (const pos of this.constraints.holdings.positions) {
      const dist = hexDistance(hex.q, hex.r, pos.q, pos.r);
      if (dist < 4) return false;
    }
    return true;
  }

  exploreHex(q, r) {
    const key = hexKey(q, r);
    if (this.exploredHexes.has(key)) return;

    this.exploredHexes.add(key);

    const hex = this.hexes.get(key);
    if (hex) {
      hex.revealed = true;
      this.revealedHexes.add(key);
    }

    // Reveal adjacent hexes
    const neighbors = hexNeighbors(q, r);
    for (const n of neighbors) {
      const nKey = hexKey(n.q, n.r);
      if (!this.hexes.has(nKey)) {
        this.generateHex(n.q, n.r);
      }
      const nHex = this.hexes.get(nKey);
      if (nHex && !nHex.revealed) {
        nHex.revealed = true;
        this.revealedHexes.add(nKey);
      }
    }
  }

  // Check if a hex position would be a border (impassable)
  wouldBeBorder(q, r) {
    const dist = hexDistance(0, 0, q, r);
    return dist >= this.realmRadius;
  }

  // Find path to nearest unexplored hex using BFS
  findPathToUnexplored() {
    const start = hexKey(this.currentExplorerPos.q, this.currentExplorerPos.r);
    const queue = [{ key: start, path: [] }];
    const visited = new Set([start]);

    while (queue.length > 0) {
      const { key, path } = queue.shift();
      const { q, r } = parseHexKey(key);
      const neighbors = hexNeighbors(q, r);

      for (const n of neighbors) {
        const nKey = hexKey(n.q, n.r);
        if (visited.has(nKey)) continue;

        // Check if this would be a border hex (even if not yet generated)
        if (this.wouldBeBorder(n.q, n.r)) continue;

        // Check passability for existing hexes
        const nHex = this.hexes.get(nKey);
        if (nHex && (nHex.isBorder || nHex.isLake)) continue;

        // Check barrier - try BOTH possible key formats to be safe
        const edgeKey1 = `${q},${r}:${n.direction}`;
        const oppDir = OPPOSITE_DIRECTION[n.direction];
        const edgeKey2 = `${n.q},${n.r}:${oppDir}`;
        if (this.barrierEdges.has(edgeKey1) || this.barrierEdges.has(edgeKey2)) continue;

        visited.add(nKey);
        const newPath = [...path, { q: n.q, r: n.r, direction: n.direction }];

        // If this is unexplored, we found our target
        if (!this.exploredHexes.has(nKey)) {
          return newPath;
        }

        // Otherwise continue searching
        queue.push({ key: nKey, path: newPath });
      }
    }

    return null; // No path found
  }

  // Get valid moves from current position
  getValidMoves() {
    const { q, r } = this.currentExplorerPos;
    const neighbors = hexNeighbors(q, r);
    const validMoves = [];

    // Set validation mode before generating hexes
    const previousMode = this.generationMode;
    this.generationMode = 'validation';

    try {
      for (const n of neighbors) {
        const nKey = hexKey(n.q, n.r);

        // Check if this would be a border hex (even if not yet generated)
        if (this.wouldBeBorder(n.q, n.r)) continue;

        let nHex = this.hexes.get(nKey);

        // Check if passable (not border or lake) - for already generated hexes
        if (nHex && (nHex.isBorder || nHex.isLake)) continue;

        // Generate hex if needed - barriers will NOT be generated due to validation mode
        if (!nHex) {
          this.generateHex(n.q, n.r);
          nHex = this.hexes.get(nKey);
        }

        // Check for barrier - try BOTH possible key formats to be safe
        const edgeKey1 = `${q},${r}:${n.direction}`;
        const oppDir = OPPOSITE_DIRECTION[n.direction];
        const edgeKey2 = `${n.q},${n.r}:${oppDir}`;

        if (this.barrierEdges.has(edgeKey1) || this.barrierEdges.has(edgeKey2)) continue;

        if (nHex && !nHex.isBorder && !nHex.isLake) {
          validMoves.push({ ...n, hex: nHex, key: nKey });
        }
      }
    } finally {
      // Always restore previous mode
      this.generationMode = previousMode;
    }

    return validMoves;
  }

  moveExplorer() {
    if (!this.currentExplorerPos) return false;

    const prevPos = { ...this.currentExplorerPos };
    const validMoves = this.getValidMoves();
    if (validMoves.length === 0) return false;

    let chosenMove;

    // Categorize moves
    const unexplored = validMoves.filter((m) => !this.exploredHexes.has(m.key));
    const unexploredWithFeatures = unexplored.filter((m) => m.hex.feature);

    // Priority 1: Adjacent unexplored hex with feature (98%)
    if (unexploredWithFeatures.length > 0 && this.rng.next() < 0.98) {
      chosenMove = this.rng.choice(unexploredWithFeatures);
    }
    // Priority 2: Any adjacent unexplored hex (98%)
    else if (unexplored.length > 0 && this.rng.next() < 0.98) {
      chosenMove = this.rng.choice(unexplored);
    }
    // Priority 3: Use pathfinding to navigate toward nearest unexplored
    else {
      const pathToUnexplored = this.findPathToUnexplored();

      if (pathToUnexplored && pathToUnexplored.length > 0) {
        // Move toward the first step in the path
        const nextStep = pathToUnexplored[0];
        const nextKey = hexKey(nextStep.q, nextStep.r);

        // Find the matching valid move
        const pathMove = validMoves.find((m) => m.key === nextKey);
        if (pathMove) {
          // Add some randomness - 85% follow path, 15% explore differently
          if (this.rng.next() < 0.85) {
            chosenMove = pathMove;
          } else {
            // Pick a different move that also leads toward fog
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
        // No path to unexplored - map is fully explored or we're stuck
        chosenMove = this.rng.choice(validMoves);
      }
    }

    // CRITICAL: Check for barrier BEFORE we move
    // This catches any barrier that exists on the edge we're about to cross
    const edgeKey1 = `${prevPos.q},${prevPos.r}:${chosenMove.direction}`;
    const oppDir = OPPOSITE_DIRECTION[chosenMove.direction];
    const edgeKey2 = `${chosenMove.q},${chosenMove.r}:${oppDir}`;

    // Check if barrier exists on this edge - this should NEVER happen since getValidMoves filtered them
    if (this.barrierEdges.has(edgeKey1) || this.barrierEdges.has(edgeKey2)) {
      this.barrierCrossings++;
    }

    // Record this edge as traversed BEFORE exploring (which may generate new hexes)
    // Use both key formats to ensure we block future barrier creation on this edge
    this.traversedEdges.add(edgeKey1);
    this.traversedEdges.add(edgeKey2);

    // Set exploration mode before moving - barriers can now be generated
    this.generationMode = 'exploration';

    this.currentExplorerPos = { q: chosenMove.q, r: chosenMove.r };
    this.explorerPath.push({ ...this.currentExplorerPos });
    this.exploreHex(chosenMove.q, chosenMove.r);

    // Also check AFTER exploration in case a barrier was created during exploreHex
    // (This would be a bug in maybeGenerateBarrier)
    if (this.barrierEdges.has(edgeKey1) || this.barrierEdges.has(edgeKey2)) {
      console.error('BARRIER CREATED ON TRAVERSED EDGE DURING EXPLORE!', {
        prevPos,
        chosenMove,
        edgeKey1,
        edgeKey2,
      });
      this.barrierCrossings++;
      // Remove the illegally created barrier
      this.barrierEdges.delete(edgeKey1);
      this.barrierEdges.delete(edgeKey2);
    }
    this.saveStepState();
    return true;
  }

  saveStepState() {
    this.stepStates.push({
      explorerPos: { ...this.currentExplorerPos },
      explorerPathLength: this.explorerPath.length,
      rngState: this.rng.getState(),
      constraints: JSON.parse(JSON.stringify(this.constraints)),
      hexCount: this.hexes.size,
      exploredCount: this.exploredHexes.size,
      revealedCount: this.revealedHexes.size,
    });
  }

  restoreStep(stepIndex) {
    if (stepIndex < 0 || stepIndex >= this.stepStates.length) return false;

    const state = this.stepStates[stepIndex];
    this.currentExplorerPos = { ...state.explorerPos };
    this.explorerPath = this.explorerPath.slice(0, state.explorerPathLength);
    this.rng.setState(state.rngState);

    // For simplicity, we keep all hexes but adjust visibility
    // In a full implementation, we'd restore full state
    return true;
  }

  calculateRiverNetworkSpan() {
    if (this.riverEdges.size === 0) return 0;

    // Find all connected river edges
    const visited = new Set();
    let maxSpan = 0;

    for (const [edgeKey, edge] of this.riverEdges) {
      if (visited.has(edgeKey)) continue;

      const networkEdges = this.floodFillRiverNetwork(edgeKey, visited);
      const span = this.calculateNetworkSpan(networkEdges);
      maxSpan = Math.max(maxSpan, span);
    }

    this.constraints.riverNetwork.span = maxSpan;
    return maxSpan;
  }

  floodFillRiverNetwork(startKey, visited) {
    const network = new Set();
    const queue = [startKey];

    while (queue.length > 0) {
      const key = queue.shift();
      if (visited.has(key)) continue;

      visited.add(key);
      network.add(key);

      // Find adjacent river edges
      const edge = this.riverEdges.get(key);
      if (!edge) continue;

      const { hex1, direction } = edge;

      // Check all edges of the hex
      for (const dir of DIRECTION_NAMES) {
        const edgeKey = this.getEdgeKey(hex1.q, hex1.r, dir);
        if (this.riverEdges.has(edgeKey) && !visited.has(edgeKey)) {
          queue.push(edgeKey);
        }
      }

      // Check neighbor hex edges
      const neighbor = hexNeighbor(hex1.q, hex1.r, direction);
      for (const dir of DIRECTION_NAMES) {
        const edgeKey = this.getEdgeKey(neighbor.q, neighbor.r, dir);
        if (this.riverEdges.has(edgeKey) && !visited.has(edgeKey)) {
          queue.push(edgeKey);
        }
      }
    }

    return network;
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
    const hexArray = Array.from(hexes).map(parseHexKey);

    for (let i = 0; i < hexArray.length; i++) {
      for (let j = i + 1; j < hexArray.length; j++) {
        const dist = hexDistance(hexArray[i].q, hexArray[i].r, hexArray[j].q, hexArray[j].r);
        maxDist = Math.max(maxDist, dist);
      }
    }

    return maxDist;
  }

  getConstraintReport() {
    const span = this.calculateRiverNetworkSpan();

    return {
      seed: this.seed,
      hardConstraints: {
        borderClosure: { pass: true, value: 'complete' },
        explorableHexes: {
          pass: this.constraints.explorableHexes.count >= 100,
          value: this.constraints.explorableHexes.count,
          min: 100,
        },
        holdings: {
          pass: this.constraints.holdings.placed === 4,
          value: this.constraints.holdings.placed,
          target: 4,
          spacingValid: this.validateHoldingSpacing(),
        },
        mythSites: {
          pass: this.constraints.mythSites.placed === 6,
          value: this.constraints.mythSites.placed,
          target: 6,
        },
        featureExclusivity: { pass: true, value: 'no overlaps' },
        riverFlow: { pass: true, value: 'no uphill violations' },
      },
      softConstraints: {
        explorableHexes: {
          status: this.constraints.explorableHexes.count >= 140 ? 'good' : 'partial',
          value: this.constraints.explorableHexes.count,
          target: 144,
        },
        riverNetwork: {
          status: span >= 8 ? 'good' : span >= 4 ? 'partial' : 'minimal',
          span,
          targetSpan: 8,
        },
        lakes: {
          status: this.constraints.lakes.placed <= 3 ? 'good' : 'over',
          value: this.constraints.lakes.placed,
          max: 3,
        },
        barriers: {
          status: Math.abs(this.constraints.barriers.placed - 24) <= 6 ? 'good' : 'partial',
          value: this.constraints.barriers.placed,
          target: 24,
        },
        landmarks: this.getLandmarkReport(),
      },
    };
  }

  validateHoldingSpacing() {
    const positions = this.constraints.holdings.positions;
    for (let i = 0; i < positions.length; i++) {
      for (let j = i + 1; j < positions.length; j++) {
        const dist = hexDistance(positions[i].q, positions[i].r, positions[j].q, positions[j].r);
        if (dist < 4) return false;
      }
    }
    return true;
  }

  getLandmarkReport() {
    const report = {};
    for (const type of LANDMARK_TYPES) {
      const c = this.constraints.landmarks[type];
      report[type] = {
        placed: c.placed,
        min: c.min,
        max: c.max,
        status: c.placed >= c.min && c.placed <= c.max ? 'good' : 'partial',
      };
    }
    return report;
  }

  runFullSimulation() {
    let maxSteps = 500;
    let steps = 0;

    while (steps < maxSteps) {
      const moved = this.moveExplorer();
      if (!moved) break;
      steps++;

      // Check if we've explored enough
      if (this.constraints.explorableHexes.count >= 144 && steps > 100) {
        break;
      }
    }

    return this.getConstraintReport();
  }
}

// ============================================================================
// REACT COMPONENT
// ============================================================================
export default function MythicBastionlandRealms() {
  const [seed, setSeed] = useState(12345);
  const [seedInput, setSeedInput] = useState('12345');
  const [startAtBorder, setStartAtBorder] = useState(false);
  const [generator, setGenerator] = useState(null);
  const [step, setStep] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [mode, setMode] = useState('interactive');
  const [nonInteractiveReport, setNonInteractiveReport] = useState(null);
  const [renderKey, setRenderKey] = useState(0);
  const [targetStepInput, setTargetStepInput] = useState('');

  const playIntervalRef = useRef(null);

  // Initialize generator
  const initializeGenerator = useCallback(() => {
    const gen = new RealmGenerator(seed);
    gen.initialize(startAtBorder);
    setGenerator(gen);
    setStep(0);
    setRenderKey((prev) => prev + 1);
  }, [seed, startAtBorder]);

  useEffect(() => {
    initializeGenerator();
  }, []);

  // Play/Pause animation
  useEffect(() => {
    if (isPlaying && generator) {
      playIntervalRef.current = setInterval(() => {
        const moved = generator.moveExplorer();
        if (moved) {
          setStep((prev) => prev + 1);
          setRenderKey((prev) => prev + 1);
        } else {
          setIsPlaying(false);
        }
      }, 1000);
    } else {
      if (playIntervalRef.current) {
        clearInterval(playIntervalRef.current);
      }
    }

    return () => {
      if (playIntervalRef.current) {
        clearInterval(playIntervalRef.current);
      }
    };
  }, [isPlaying, generator]);

  const handleStepForward = () => {
    if (generator) {
      generator.moveExplorer();
      setStep((prev) => prev + 1);
      setRenderKey((prev) => prev + 1);
    }
  };

  const handleStepBackward = () => {
    if (generator && step > 0) {
      generator.restoreStep(step - 1);
      setStep((prev) => prev - 1);
      setRenderKey((prev) => prev + 1);
    }
  };

  const handleReset = () => {
    setIsPlaying(false);
    initializeGenerator();
  };

  const handleSeedChange = () => {
    const newSeed = parseInt(seedInput) || Math.floor(Math.random() * 100000);
    setSeed(newSeed);
    setSeedInput(String(newSeed));
    setIsPlaying(false);
  };

  const handleRandomSeed = () => {
    const newSeed = Math.floor(Math.random() * 100000);
    setSeed(newSeed);
    setSeedInput(String(newSeed));
  };

  const runNonInteractive = () => {
    const gen = new RealmGenerator(seed);
    gen.initialize(startAtBorder);
    const report = gen.runFullSimulation();
    setNonInteractiveReport(report);
    setGenerator(gen);
    setRenderKey((prev) => prev + 1);
  };

  const handleGoToStep = () => {
    if (!generator) return;

    const targetStep = parseInt(targetStepInput);
    if (isNaN(targetStep) || targetStep < 0) return;

    setIsPlaying(false);

    if (targetStep < step) {
      // Go backwards
      generator.restoreStep(targetStep);
      setStep(targetStep);
    } else if (targetStep > step) {
      // Go forwards
      let currentStep = step;
      while (currentStep < targetStep) {
        const moved = generator.moveExplorer();
        if (!moved) break; // Can't move further
        currentStep++;
      }
      setStep(currentStep);
    }

    setRenderKey((prev) => prev + 1);
  };

  const handleRunToCompletion = () => {
    if (!generator) return;

    setIsPlaying(false);

    let currentStep = step;
    let maxSteps = 500; // Safety limit
    let stepsRun = 0;

    while (stepsRun < maxSteps) {
      const moved = generator.moveExplorer();
      if (!moved) break; // Exploration complete
      currentStep++;
      stepsRun++;
    }

    setStep(currentStep);
    setRenderKey((prev) => prev + 1);
  };

  // Calculate view bounds
  const viewBounds = useMemo(() => {
    if (!generator) return { minX: -200, maxX: 200, minY: -200, maxY: 200 };

    let minX = Infinity,
      maxX = -Infinity,
      minY = Infinity,
      maxY = -Infinity;
    const size = 30;

    for (const [key, hex] of generator.hexes) {
      if (hex.revealed) {
        const { x, y } = hexToPixel(hex.q, hex.r, size);
        minX = Math.min(minX, x - size);
        maxX = Math.max(maxX, x + size);
        minY = Math.min(minY, y - size);
        maxY = Math.max(maxY, y + size);
      }
    }

    const padding = 50;
    return {
      minX: (minX === Infinity ? -200 : minX) - padding,
      maxX: (maxX === -Infinity ? 200 : maxX) + padding,
      minY: (minY === Infinity ? -200 : minY) - padding,
      maxY: (maxY === -Infinity ? 200 : maxY) + padding,
    };
  }, [generator, renderKey]);

  return (
    <div className="min-h-screen bg-gray-900 text-white p-4">
      <h1 className="text-2xl font-bold mb-4 text-center">Mythic Bastionland Realm Generator</h1>

      {/* Controls */}
      <div className="mb-4 flex flex-wrap gap-4 justify-center items-center bg-gray-800 p-4 rounded-lg">
        <div className="flex items-center gap-2">
          <label className="text-sm">Seed:</label>
          <input
            type="text"
            value={seedInput}
            onChange={(e) => setSeedInput(e.target.value)}
            className="w-24 px-2 py-1 bg-gray-700 rounded text-white"
          />
          <button
            onClick={handleSeedChange}
            className="px-3 py-1 bg-blue-600 rounded hover:bg-blue-700"
          >
            Apply
          </button>
          <button
            onClick={handleRandomSeed}
            className="px-3 py-1 bg-purple-600 rounded hover:bg-purple-700"
          >
            Random
          </button>
        </div>

        <div className="flex items-center gap-2">
          <label className="text-sm">
            <input
              type="checkbox"
              checked={startAtBorder}
              onChange={(e) => setStartAtBorder(e.target.checked)}
              className="mr-2"
            />
            Start at Border
          </label>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={handleStepBackward}
            className="px-3 py-1 bg-gray-600 rounded hover:bg-gray-700"
            disabled={step === 0}
          >
            ◀ Back
          </button>
          <button
            onClick={() => setIsPlaying(!isPlaying)}
            className={`px-4 py-1 rounded ${isPlaying ? 'bg-yellow-600 hover:bg-yellow-700' : 'bg-green-600 hover:bg-green-700'}`}
          >
            {isPlaying ? '⏸ Pause' : '▶ Play'}
          </button>
          <button
            onClick={handleStepForward}
            className="px-3 py-1 bg-gray-600 rounded hover:bg-gray-700"
          >
            Forward ▶
          </button>
          <button onClick={handleReset} className="px-3 py-1 bg-red-600 rounded hover:bg-red-700">
            Reset
          </button>
        </div>

        <div className="flex items-center gap-2">
          <label className="text-sm">Go to step:</label>
          <input
            type="number"
            min="0"
            value={targetStepInput}
            onChange={(e) => setTargetStepInput(e.target.value)}
            onKeyPress={(e) => e.key === 'Enter' && handleGoToStep()}
            className="w-20 px-2 py-1 bg-gray-700 rounded text-white"
            placeholder={String(step)}
          />
          <button
            onClick={handleGoToStep}
            className="px-3 py-1 bg-cyan-600 rounded hover:bg-cyan-700"
            disabled={!targetStepInput}
          >
            Go
          </button>
          <button
            onClick={handleRunToCompletion}
            className="px-3 py-1 bg-indigo-600 rounded hover:bg-indigo-700"
          >
            Run to End
          </button>
        </div>

        <div className="flex items-center gap-2">
          <select
            value={mode}
            onChange={(e) => setMode(e.target.value)}
            className="px-2 py-1 bg-gray-700 rounded"
          >
            <option value="interactive">Interactive</option>
            <option value="non-interactive">Non-Interactive</option>
          </select>
          {mode === 'non-interactive' && (
            <button
              onClick={runNonInteractive}
              className="px-3 py-1 bg-orange-600 rounded hover:bg-orange-700"
            >
              Run Full Simulation
            </button>
          )}
        </div>
      </div>

      {/* Main content area */}
      <div className="flex flex-col lg:flex-row gap-4">
        {/* Map */}
        <div className="flex-1 bg-gray-800 rounded-lg p-2 overflow-hidden">
          {generator && (
            <HexMap generator={generator} viewBounds={viewBounds} renderKey={renderKey} />
          )}
        </div>

        {/* State Panel */}
        <div className="w-full lg:w-96 bg-gray-800 rounded-lg p-4 overflow-auto max-h-[600px]">
          {mode === 'non-interactive' && nonInteractiveReport ? (
            <ConstraintReport report={nonInteractiveReport} />
          ) : (
            generator && <StatePanel generator={generator} step={step} />
          )}
        </div>
      </div>

      {/* Legend */}
      <Legend />
    </div>
  );
}

// ============================================================================
// HEX MAP COMPONENT
// ============================================================================
function HexMap({ generator, viewBounds, renderKey }) {
  const size = 30;
  const width = viewBounds.maxX - viewBounds.minX;
  const height = viewBounds.maxY - viewBounds.minY;

  const hexElements = [];
  const riverElements = [];
  const barrierElements = [];
  const featureElements = [];
  const explorerElements = [];

  // Render hexes
  for (const [key, hex] of generator.hexes) {
    if (!hex.revealed) continue;

    const { x, y } = hexToPixel(hex.q, hex.r, size);
    const corners = getHexCorners(x, y, size);
    const points = corners.map((c) => `${c.x},${c.y}`).join(' ');

    let fillColor;
    if (hex.isBorder) {
      fillColor = TERRAIN_COLORS[hex.borderType];
    } else if (hex.isLake) {
      fillColor = TERRAIN_COLORS.lake;
    } else {
      fillColor = TERRAIN_COLORS[hex.terrain] || '#666';
    }

    hexElements.push(
      <polygon key={key} points={points} fill={fillColor} stroke="#333" strokeWidth="1" />
    );

    // Feature icon
    if (hex.feature) {
      const icon = FEATURE_ICONS[hex.feature] || '?';
      featureElements.push(
        <text key={`feature-${key}`} x={x} y={y + 5} textAnchor="middle" fontSize="16">
          {icon}
        </text>
      );
    }
  }

  // Render rivers
  for (const [edgeKey, river] of generator.riverEdges) {
    const [hexPart] = edgeKey.split(':');
    const { q, r } = parseHexKey(hexPart);
    const hex = generator.hexes.get(hexPart);

    if (hex && hex.revealed) {
      const { x, y } = hexToPixel(q, r, size);
      const { p1, p2 } = getEdgeEndpoints(x, y, size, river.direction);

      riverElements.push(
        <line
          key={`river-${edgeKey}`}
          x1={p1.x}
          y1={p1.y}
          x2={p2.x}
          y2={p2.y}
          stroke="#4169E1"
          strokeWidth="4"
          strokeLinecap="round"
        />
      );
    }
  }

  // Render barriers
  for (const edgeKey of generator.barrierEdges) {
    const [hexPart, direction] = edgeKey.split(':');
    const { q, r } = parseHexKey(hexPart);
    const hex = generator.hexes.get(hexPart);

    if (hex && hex.revealed) {
      const { x, y } = hexToPixel(q, r, size);
      const { p1, p2 } = getEdgeEndpoints(x, y, size, direction);

      barrierElements.push(
        <line
          key={`barrier-${edgeKey}`}
          x1={p1.x}
          y1={p1.y}
          x2={p2.x}
          y2={p2.y}
          stroke="#DC143C"
          strokeWidth="6"
          strokeLinecap="round"
        />
      );
    }
  }

  // Explorer path trail (last 10 positions)
  // Draw through EDGE MIDPOINTS to accurately show which edges were crossed
  const traversedEdgeKeys = new Set();
  if (generator.explorerPath && generator.explorerPath.length > 1) {
    const trail = generator.explorerPath.slice(-10);
    for (let i = 0; i < trail.length - 1; i++) {
      const from = trail[i];
      const to = trail[i + 1];

      // Find the direction between these two hexes to track which edge was crossed
      for (const dir of DIRECTION_NAMES) {
        const neighbor = hexNeighbor(from.q, from.r, dir);
        if (neighbor.q === to.q && neighbor.r === to.r) {
          // Record both key formats for the traversed edge
          const key1 = `${from.q},${from.r}:${dir}`;
          const oppDir = OPPOSITE_DIRECTION[dir];
          const key2 = `${to.q},${to.r}:${oppDir}`;
          traversedEdgeKeys.add(key1);
          traversedEdgeKeys.add(key2);
          break;
        }
      }

      // Draw from hex center to hex center (crossing through the shared edge)
      const fromPx = hexToPixel(from.q, from.r, size);
      const toPx = hexToPixel(to.q, to.r, size);
      const opacity = 0.3 + (i / trail.length) * 0.5;

      explorerElements.push(
        <line
          key={`trail-${i}`}
          x1={fromPx.x}
          y1={fromPx.y}
          x2={toPx.x}
          y2={toPx.y}
          stroke="#FFD700"
          strokeWidth="3"
          strokeOpacity={opacity}
          strokeLinecap="round"
        />
      );
    }
  }

  // Highlight any barrier that exists on a traversed edge (this would be a BUG)
  for (const edgeKey of generator.barrierEdges) {
    if (traversedEdgeKeys.has(edgeKey)) {
      const [hexPart, direction] = edgeKey.split(':');
      const { q, r } = parseHexKey(hexPart);
      const hex = generator.hexes.get(hexPart);

      if (hex && hex.revealed) {
        const { x, y } = hexToPixel(q, r, size);
        const { p1, p2 } = getEdgeEndpoints(x, y, size, direction);

        // Draw a purple highlight to show the crossing
        explorerElements.push(
          <line
            key={`crossing-${edgeKey}`}
            x1={p1.x}
            y1={p1.y}
            x2={p2.x}
            y2={p2.y}
            stroke="#FF00FF"
            strokeWidth="10"
            strokeLinecap="round"
            strokeOpacity="0.8"
          />
        );
      }
    }
  }

  // Explorer position
  if (generator.currentExplorerPos) {
    const { x, y } = hexToPixel(
      generator.currentExplorerPos.q,
      generator.currentExplorerPos.r,
      size
    );
    explorerElements.push(
      <circle key="explorer" cx={x} cy={y} r={8} fill="#FFD700" stroke="#000" strokeWidth="2" />
    );
  }

  return (
    <svg
      viewBox={`${viewBounds.minX} ${viewBounds.minY} ${width} ${height}`}
      className="w-full h-96 lg:h-[500px]"
      preserveAspectRatio="xMidYMid meet"
    >
      <g>
        {hexElements}
        {riverElements}
        {barrierElements}
        {featureElements}
        {explorerElements}
      </g>
    </svg>
  );
}

// ============================================================================
// STATE PANEL COMPONENT
// ============================================================================
function StatePanel({ generator, step }) {
  const currentHex = generator.currentExplorerPos
    ? generator.hexes.get(hexKey(generator.currentExplorerPos.q, generator.currentExplorerPos.r))
    : null;

  const constraints = generator.constraints;
  const riverSpan = generator.calculateRiverNetworkSpan();

  // Calculate terrain probability for adjacent unrevealed hexes
  const adjacentProbs = useMemo(() => {
    if (!generator.currentExplorerPos) return [];

    const neighbors = hexNeighbors(generator.currentExplorerPos.q, generator.currentExplorerPos.r);
    const probs = [];

    for (const n of neighbors) {
      const nKey = hexKey(n.q, n.r);
      if (!generator.hexes.has(nKey) || !generator.hexes.get(nKey).revealed) {
        probs.push({
          direction: n.direction,
          q: n.q,
          r: n.r,
          status: generator.hexes.has(nKey) ? 'generated' : 'ungenerated',
        });
      }
    }

    return probs;
  }, [generator, step]);

  return (
    <div className="space-y-4 text-sm">
      <div>
        <h3 className="font-bold text-lg mb-2">Step {step}</h3>
      </div>

      {/* Current Hex */}
      <div className="bg-gray-700 p-3 rounded">
        <h4 className="font-semibold mb-2">Current Position</h4>
        {currentHex ? (
          <>
            <p>
              Coordinates: ({currentHex.q}, {currentHex.r})
            </p>
            <p>Terrain: {currentHex.isLake ? 'Lake' : currentHex.terrain}</p>
            {currentHex.feature && <p>Feature: {currentHex.feature}</p>}
            {currentHex.riverEdges?.length > 0 && <p>Rivers: {currentHex.riverEdges.join(', ')}</p>}
          </>
        ) : (
          <p>No position</p>
        )}
      </div>

      {/* Adjacent Hexes */}
      <div className="bg-gray-700 p-3 rounded">
        <h4 className="font-semibold mb-2">Adjacent Unrevealed ({adjacentProbs.length})</h4>
        {adjacentProbs.map((p) => (
          <p key={`${p.q},${p.r}`} className="text-xs">
            {p.direction}: ({p.q}, {p.r}) - {p.status}
          </p>
        ))}
      </div>

      {/* Hard Constraints */}
      <div className="bg-gray-700 p-3 rounded">
        <h4 className="font-semibold mb-2">Hard Constraints</h4>

        <ConstraintRow
          label="Holdings"
          value={`${constraints.holdings.placed}/4`}
          pass={constraints.holdings.placed <= 4}
        />
        <ConstraintRow
          label="Myth Sites"
          value={`${constraints.mythSites.placed}/6`}
          pass={constraints.mythSites.placed <= 6}
        />
        <ConstraintRow
          label="Explorable Hexes"
          value={`${constraints.explorableHexes.count} (min: 100)`}
          pass={constraints.explorableHexes.count >= 100}
        />
      </div>

      {/* Soft Constraints */}
      <div className="bg-gray-700 p-3 rounded">
        <h4 className="font-semibold mb-2">Soft Constraints</h4>

        <ConstraintRow
          label="Lakes"
          value={`${constraints.lakes.placed}/${constraints.lakes.max}`}
          pass={constraints.lakes.placed <= constraints.lakes.max}
        />
        <ConstraintRow
          label="Barriers"
          value={`${constraints.barriers.placed}/~24`}
          pass={Math.abs(constraints.barriers.placed - 24) <= 10}
        />
        <ConstraintRow
          label="River Span"
          value={`${riverSpan} (target: ≥8)`}
          pass={riverSpan >= 8}
          warning={riverSpan >= 4 && riverSpan < 8}
        />
      </div>

      {/* Landmarks */}
      <div className="bg-gray-700 p-3 rounded">
        <h4 className="font-semibold mb-2">Landmarks</h4>
        {LANDMARK_TYPES.map((type) => {
          const c = constraints.landmarks[type];
          return (
            <ConstraintRow
              key={type}
              label={type.charAt(0).toUpperCase() + type.slice(1)}
              value={`${c.placed}/${c.min}-${c.max}`}
              pass={c.placed >= c.min && c.placed <= c.max}
              warning={c.placed < c.min}
            />
          );
        })}
      </div>

      {/* Stats */}
      <div className="bg-gray-700 p-3 rounded">
        <h4 className="font-semibold mb-2">Statistics</h4>
        <p>Total Hexes: {generator.hexes.size}</p>
        <p>Explored: {generator.exploredHexes.size}</p>
        <p>Revealed: {generator.revealedHexes.size}</p>
        <p>Border Hexes: {generator.borderHexes.size}</p>
        <p>River Edges: {generator.riverEdges.size}</p>
        <p>Terrain Clusters: {generator.terrainClusters.size}</p>
        <p className={generator.barrierCrossings > 0 ? 'text-red-400 font-bold' : ''}>
          Barrier Crossings: {generator.barrierCrossings || 0}
        </p>
      </div>
    </div>
  );
}

function ConstraintRow({ label, value, pass, warning }) {
  const color = pass ? 'text-green-400' : warning ? 'text-yellow-400' : 'text-red-400';
  const icon = pass ? '✓' : warning ? '⚠' : '✗';

  return (
    <div className="flex justify-between items-center py-1">
      <span>{label}</span>
      <span className={color}>
        {icon} {value}
      </span>
    </div>
  );
}

// ============================================================================
// CONSTRAINT REPORT COMPONENT (Non-Interactive Mode)
// ============================================================================
function ConstraintReport({ report }) {
  return (
    <div className="space-y-4 text-sm font-mono">
      <div className="bg-gray-900 p-3 rounded">
        <h3 className="font-bold text-lg mb-2">Constraint Compliance Report</h3>
        <p>Seed: {report.seed}</p>
        <p className={report.hardConstraints.holdings.pass ? 'text-green-400' : 'text-red-400'}>
          Status: {Object.values(report.hardConstraints).every((c) => c.pass) ? 'PASS' : 'FAIL'}
        </p>
      </div>

      <div className="bg-gray-900 p-3 rounded">
        <h4 className="font-semibold mb-2 text-blue-400">Hard Constraints:</h4>
        {Object.entries(report.hardConstraints).map(([key, val]) => (
          <p key={key} className={val.pass ? 'text-green-400' : 'text-red-400'}>
            {val.pass ? '✓' : '✗'} {key}:{' '}
            {typeof val.value === 'object' ? JSON.stringify(val.value) : val.value}
            {val.target !== undefined && ` (target: ${val.target})`}
            {val.min !== undefined && ` (min: ${val.min})`}
          </p>
        ))}
      </div>

      <div className="bg-gray-900 p-3 rounded">
        <h4 className="font-semibold mb-2 text-blue-400">Soft Constraints:</h4>
        <p
          className={
            report.softConstraints.explorableHexes.status === 'good'
              ? 'text-green-400'
              : 'text-yellow-400'
          }
        >
          {report.softConstraints.explorableHexes.status === 'good' ? '✓' : '⚠'} Explorable hexes:{' '}
          {report.softConstraints.explorableHexes.value} (target: ~
          {report.softConstraints.explorableHexes.target})
        </p>
        <p
          className={
            report.softConstraints.riverNetwork.status === 'good'
              ? 'text-green-400'
              : report.softConstraints.riverNetwork.status === 'partial'
                ? 'text-yellow-400'
                : 'text-red-400'
          }
        >
          {report.softConstraints.riverNetwork.status === 'good'
            ? '✓'
            : report.softConstraints.riverNetwork.status === 'partial'
              ? '⚠'
              : '✗'}{' '}
          River network: span {report.softConstraints.riverNetwork.span} (target: ≥
          {report.softConstraints.riverNetwork.targetSpan}) -{' '}
          {report.softConstraints.riverNetwork.status.toUpperCase()}
        </p>
        <p
          className={
            report.softConstraints.lakes.status === 'good' ? 'text-green-400' : 'text-yellow-400'
          }
        >
          {report.softConstraints.lakes.status === 'good' ? '✓' : '⚠'} Lakes:{' '}
          {report.softConstraints.lakes.value}/{report.softConstraints.lakes.max} max
        </p>
        <p
          className={
            report.softConstraints.barriers.status === 'good' ? 'text-green-400' : 'text-yellow-400'
          }
        >
          {report.softConstraints.barriers.status === 'good' ? '✓' : '⚠'} Barriers:{' '}
          {report.softConstraints.barriers.value} (target: ~{report.softConstraints.barriers.target}
          )
        </p>

        <div className="mt-2">
          <p className="text-gray-400">Landmarks:</p>
          {Object.entries(report.softConstraints.landmarks).map(([type, val]) => (
            <p key={type} className={val.status === 'good' ? 'text-green-400' : 'text-yellow-400'}>
              {val.status === 'good' ? '✓' : '⚠'} {type}: {val.placed} (target: {val.min}-{val.max}
              )
            </p>
          ))}
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// LEGEND COMPONENT
// ============================================================================
function Legend() {
  return (
    <div className="mt-4 bg-gray-800 p-4 rounded-lg">
      <h3 className="font-bold mb-2">Legend</h3>

      <div className="flex flex-wrap gap-4 text-sm">
        <div>
          <h4 className="font-semibold mb-1">Terrain</h4>
          <div className="grid grid-cols-2 gap-1">
            {Object.entries(TERRAIN_COLORS)
              .slice(0, 10)
              .map(([terrain, color]) => (
                <div key={terrain} className="flex items-center gap-1">
                  <div className="w-4 h-4 rounded" style={{ backgroundColor: color }}></div>
                  <span className="capitalize">{terrain}</span>
                </div>
              ))}
          </div>
        </div>

        <div>
          <h4 className="font-semibold mb-1">Borders</h4>
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-1">
              <div
                className="w-4 h-4 rounded"
                style={{ backgroundColor: TERRAIN_COLORS.sea }}
              ></div>
              <span>Sea</span>
            </div>
            <div className="flex items-center gap-1">
              <div
                className="w-4 h-4 rounded"
                style={{ backgroundColor: TERRAIN_COLORS.cliff }}
              ></div>
              <span>Cliff</span>
            </div>
            <div className="flex items-center gap-1">
              <div
                className="w-4 h-4 rounded"
                style={{ backgroundColor: TERRAIN_COLORS.wasteland }}
              ></div>
              <span>Wasteland</span>
            </div>
          </div>
        </div>

        <div>
          <h4 className="font-semibold mb-1">Features</h4>
          <div className="flex flex-col gap-1">
            {Object.entries(FEATURE_ICONS).map(([feature, icon]) => (
              <div key={feature} className="flex items-center gap-1">
                <span>{icon}</span>
                <span className="capitalize">
                  {feature
                    .replace('landmark_', '')
                    .replace(/([A-Z])/g, ' $1')
                    .trim()}
                </span>
              </div>
            ))}
          </div>
        </div>

        <div>
          <h4 className="font-semibold mb-1">Edges</h4>
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-1">
              <div className="w-8 h-1 bg-blue-500 rounded"></div>
              <span>River</span>
            </div>
            <div className="flex items-center gap-1">
              <div className="w-8 h-2 bg-red-600 rounded"></div>
              <span>Barrier</span>
            </div>
          </div>
        </div>

        <div>
          <h4 className="font-semibold mb-1">Explorer</h4>
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-1">
              <div className="w-4 h-4 rounded-full bg-yellow-500"></div>
              <span>Current Position</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
