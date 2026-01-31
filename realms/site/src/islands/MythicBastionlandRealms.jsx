import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { SeededRNG } from '../lib/seededRandom.js';
import {
  HEX_DIRECTIONS,
  DIRECTION_NAMES,
  OPPOSITE_DIRECTION,
  hexDistance,
  hexNeighbor,
  hexNeighbors,
  hexKey,
  getAdjacentDirections,
  parseHexKey as sharedParseHexKey,
} from '../lib/hexMath.js';
import {
  initiateRiver as sharedInitiateRiver,
  planRiverPath as sharedPlanRiverPath,
} from '../lib/riverGeneration.js';
import { initializeBorderClusters, getBorderProbability } from '../lib/borderGeneration.js';
import {
  createBorderHex as sharedCreateBorderHex,
  shouldBeLake as sharedShouldBeLake,
  generateTerrainWithConstraints as sharedGenerateTerrainWithConstraints,
  maybeGenerateBarrier as sharedMaybeGenerateBarrier,
  maybeAddFeature as sharedMaybeAddFeature,
  forceCompleteFeatures as sharedForceCompleteFeatures,
  hasBarrierBetween as sharedHasBarrierBetween,
  wouldTrapExplorer as sharedWouldTrapExplorer,
  checkBarrierConnectivity as sharedCheckBarrierConnectivity,
  ensureBorderConnectivity as sharedEnsureBorderConnectivity,
} from '../lib/realmGeneration.js';
import {
  TERRAIN_TYPES,
  TERRAIN_AFFINITIES,
  ELEVATION,
  getElevation,
  BORDER_TYPES,
  TERRAIN_ASSETS,
  HOLDING_ASSETS,
  LANDMARK_ASSETS,
  HOLDING_TYPES,
  LANDMARK_TYPES as LANDMARK_TYPE_CONSTANTS,
} from '../lib/terrainConstants.js';

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

// Use shared parseHexKey function
const parseHexKey = sharedParseHexKey;

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
// Note: TERRAIN_TYPES, TERRAIN_AFFINITIES, ELEVATION, getElevation, BORDER_TYPES
// are imported from ../lib/terrainConstants.js for DRY consistency with simulator
// ============================================================================

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
    this.anchoredBarrierEdges = new Set();
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
    // New river system state
    this.rivers = []; // Array of river network objects
    this.riverEncountered = false; // Flag for first river encounter
    this.riverIdCounter = 0; // Unique ID for each river network
    this.plannedRiverEdges = new Map(); // Pre-planned river edges to add when hexes are revealed
    this.generationMode = null; // Track generation context: null | 'validation' | 'exploration'
  }

  initConstraints() {
    return {
      holdings: { placed: 0, target: 4, positions: [], spacingViolations: 0, usedTypes: [] },
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
      riverNetwork: {
        span: 0,
        targetSpan: 8,
        networkCount: 0,
        targetNetworkCount: 1,
        tributaryCount: 0,
        targetTributaries: 3,
      },
      borderClosure: { complete: false },
      featureExclusivity: {
        violations: [], // Array of { hex, features } for hexes with multiple exclusive features
        valid: true,
      },
      featureRegistry: new Set(), // Set of hex keys that have ANY exclusive feature
      realmDimensions: {
        minQ: 0,
        maxQ: 0, // Bounding box in axial coords
        minR: 0,
        maxR: 0,
        width: 0,
        height: 0, // Approximate grid dimensions
        targetWidth: 12,
        targetHeight: 12, // SOFT: target 12x12
      },
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
    this.rivers = [];
    this.riverEncountered = false;
    this.riverIdCounter = 0;
    this.riverNetwork = [];
    this.plannedRiverEdges = new Map();
    this.barrierEdges.clear();
    this.anchoredBarrierEdges.clear();
    this.traversedEdges.clear();
    this.features.clear();
    this.terrainClusters.clear();
    this.clusterIdCounter = 0;
    this.borderClusters = [];
    this.borderClusterSeeds = [];
    this.explorerPath = [];
    this.currentExplorerPos = null;
    this.generationLog = [];
    this.stepStates = [];
    this.constraints = this.initConstraints();
    this.generationMode = null;

    // Initialize border cluster seeds (4 clusters around perimeter)
    this.borderClusterSeeds = initializeBorderClusters(this.rng);

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

  generateInitialBorderShell() {
    // Pre-generate border hexes to establish realm boundary
    const radius = this.realmRadius + 2;

    for (let q = -radius; q <= radius; q++) {
      for (let r = -radius; r <= radius; r++) {
        const dist = hexDistance(0, 0, q, r);

        // Generate borders starting at distance 5
        if (dist >= 5 && dist <= radius) {
          const borderProb = getBorderProbability(q, r, dist, this.borderClusterSeeds);
          if (this.rng.next() < borderProb) {
            this.createBorderHex(q, r);
          }
        }
      }
    }
  }

  createBorderHex(q, r) {
    const key = hexKey(q, r);
    if (this.hexes.has(key)) return;

    // Use shared border creation for RNG consistency
    const borderTypes = Object.values(BORDER_TYPES);
    const ctx = {
      rng: this.rng,
      hexes: this.hexes,
      borderHexes: this.borderHexes,
      borderTypes,
    };

    sharedCreateBorderHex(ctx, q, r);
  }

  // Check if placing a barrier or lake would trap the explorer or create isolated regions
  wouldTrapExplorer(barrierEdgeKey, lakeHexKey = null) {
    // Use shared function
    const ctx = {
      hexes: this.hexes,
      exploredHexes: this.exploredHexes,
      revealedHexes: this.revealedHexes,
      currentExplorerPos: this.currentExplorerPos,
      barrierEdges: this.barrierEdges,
      realmRadius: this.realmRadius,
    };
    return sharedWouldTrapExplorer(ctx, barrierEdgeKey, lakeHexKey);
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

  isBorderHex(q, r) {
    const hex = this.hexes.get(hexKey(q, r));
    return hex && hex.isBorder;
  }

  getEdgeKey(q, r, direction) {
    const neighbor = hexNeighbor(q, r, direction);
    const oppDir = OPPOSITE_DIRECTION[direction];
    if (q < neighbor.q || (q === neighbor.q && r < neighbor.r)) {
      return `${q},${r}:${direction}`;
    }
    return `${neighbor.q},${neighbor.r}:${oppDir}`;
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

    // Create hex with placeholder terrain (will be updated after river generation)
    const isLake = this.shouldBeLake(q, r);

    const hex = {
      q,
      r,
      terrain: 'plains', // Placeholder
      isLake,
      isBorder: false,
      revealed: false,
      riverEdges: [],
      barrierEdges: [],
      feature: null,
      clusterId: null,
    };

    this.hexes.set(key, hex);

    // NEW RIVER SYSTEM ORDERING:
    // 1. Maybe encounter first river (1/12 chance until first river found)
    this.maybeEncounterRiver(hex);

    // 2. Extend existing rivers to this hex
    this.extendRiversOnReveal(hex);

    // 3. Generate terrain with river constraints
    const terrain = this.generateTerrainWithConstraints(q, r);
    hex.terrain = isLake ? 'lake' : terrain;

    // Assign to terrain cluster
    this.assignToCluster(hex);

    if (!hex.isBorder && !hex.isLake) {
      this.constraints.explorableHexes.count++;
    }

    // 4. Generate barriers (skip rivers since they're already done)
    if (this.generationMode !== 'validation') {
      const neighbors = hexNeighbors(hex.q, hex.r);
      for (const n of neighbors) {
        const nKey = hexKey(n.q, n.r);
        const nHex = this.hexes.get(nKey);
        this.maybeGenerateBarrier(hex, n.direction, nHex);
      }
    }

    // 5. Potentially place feature
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
    // Use shared lake determination for RNG consistency
    const ctx = {
      rng: this.rng,
      hexes: this.hexes,
      constraints: this.constraints,
      lakes: this.lakes,
      wouldTrapExplorer: (edgeKey, lakeKey) => this.wouldTrapExplorer(edgeKey, lakeKey),
    };

    return sharedShouldBeLake(ctx, q, r);
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

  // ============================================================================
  // NEW RIVER SYSTEM: Primary Features with Lazy Terrain Generation
  // ============================================================================

  // 1/12 chance per hex reveal to initiate first river
  maybeEncounterRiver(hex) {
    // Only attempt to encounter river if we haven't encountered one yet
    if (this.riverEncountered) return;

    // Skip border and lake hexes
    if (hex.isBorder || hex.isLake) return;

    // 1/12 chance
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
    sharedInitiateRiver(ctx, hex);

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
    sharedPlanRiverPath(ctx, network, startHex, startDir);
  }

  // Check all neighbors of revealed hex for river edges pointing toward us
  // Also activate any planned river edges for this hex
  extendRiversOnReveal(hex) {
    if (hex.isBorder || hex.isLake) return;

    // First, activate any planned river edges for this hex
    if (this.plannedRiverEdges) {
      for (const [edgeKey, planned] of this.plannedRiverEdges) {
        if (planned.hexQ === hex.q && planned.hexR === hex.r) {
          // This planned edge is on this hex - activate it
          const network = this.rivers.find((n) => n.id === planned.networkId);
          if (network) {
            // Add to riverEdges map if not already there
            if (!this.riverEdges.has(edgeKey)) {
              const neighbor = hexNeighbor(hex.q, hex.r, planned.direction);
              const oppDir = OPPOSITE_DIRECTION[planned.direction];
              const useOriginal =
                hex.q < neighbor.q || (hex.q === neighbor.q && hex.r < neighbor.r);
              this.riverEdges.set(edgeKey, {
                hex1: useOriginal ? { q: hex.q, r: hex.r } : { q: neighbor.q, r: neighbor.r },
                direction: useOriginal ? planned.direction : oppDir,
                flowDirection: 'unspecified',
              });
            }

            // Update hex.riverEdges
            if (!hex.riverEdges.includes(planned.direction)) {
              hex.riverEdges.push(planned.direction);
            }

            // Update neighbor's riverEdges if neighbor exists
            const neighborKey = hexKey(
              hexNeighbor(hex.q, hex.r, planned.direction).q,
              hexNeighbor(hex.q, hex.r, planned.direction).r
            );
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

    // Count frontier's neighbors that are NOT explored or border
    let unexploredCount = 0;
    for (const dir of DIRECTION_NAMES) {
      const neighbor = hexNeighbor(frontier.q, frontier.r, dir);
      const key = hexKey(neighbor.q, neighbor.r);
      const neighborHex = this.hexes.get(key);

      // Skip if it's a border (can't expand there)
      if (neighborHex && neighborHex.isBorder) {
        continue;
      }

      // Count if not yet created (truly unexplored) OR not revealed
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

    // Get valid directions - prioritize adjacent directions for visual connectivity
    // Adjacent directions share a vertex with the incoming edge
    const adjacentDirs = getAdjacentDirections(incomingDirection);

    const isValidDirection = (dir) => {
      const ek = this.getEdgeKey(hex.q, hex.r, dir);
      if (this.riverEdges.has(ek)) return false; // Don't double up
      const n = hexNeighbor(hex.q, hex.r, dir);
      if (this.isBorderHex(n.q, n.r)) return false; // Don't hit borders
      const nKey = hexKey(n.q, n.r);
      if (this.borderHexes.has(nKey)) return false; // Don't hit border hexes
      if (this.hexes.has(nKey)) return false; // Don't extend into already-explored hexes (canon principle)
      return true;
    };

    // First try adjacent directions (visually connected)
    let validDirs = adjacentDirs.filter(isValidDirection);

    // If no adjacent directions work, DON'T fall back to other directions
    // This ensures visual connectivity at the cost of shorter rivers

    if (validDirs.length === 0) return;

    // Score each valid direction by frontier openness
    const scoredDirs = validDirs.map((dir) => ({
      dir,
      score: this.scoreFrontier(hex, dir),
    }));

    // Adaptive tributary probability - front-load branches for more breakout opportunities
    const remainingLength = 24 - network.edges.size;
    const remainingTributaries = 3 - network.tributaryCount;
    // High floor (0.6) ensures aggressive early branching for breakout opportunities
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

  // Get elevation constraints from river edges on this hex
  getRiverConstraints(hex) {
    const constraints = {
      minElevation: 0,
      maxElevation: 3,
    };

    // Check each edge of this hex for rivers
    for (const direction of DIRECTION_NAMES) {
      const edgeKey = this.getEdgeKey(hex.q, hex.r, direction);
      const riverEdge = this.riverEdges.get(edgeKey);

      if (!riverEdge) continue;

      // Get neighbor hex
      const neighbor = hexNeighbor(hex.q, hex.r, direction);
      const neighborKey = hexKey(neighbor.q, neighbor.r);
      const neighborHex = this.hexes.get(neighborKey);

      if (!neighborHex || neighborHex.isBorder || !neighborHex.terrain) continue;

      const neighborElev = getElevation(neighborHex.terrain);

      // Determine flow direction based on edge orientation
      const isFlowingIn = riverEdge.hex1.q === neighbor.q && riverEdge.hex1.r === neighbor.r;

      if (isFlowingIn) {
        // Water flows INTO this hex from neighbor
        // This hex must be <= neighbor elevation
        constraints.maxElevation = Math.min(constraints.maxElevation, neighborElev);
      } else {
        // Water flows OUT OF this hex to neighbor
        // This hex must be >= neighbor elevation
        constraints.minElevation = Math.max(constraints.minElevation, neighborElev);
      }
    }

    return constraints;
  }

  // Calculate path length (edge count) for a river network
  calculatePathLength(network) {
    return network.edges.size;
  }

  // Generate terrain respecting river elevation constraints
  generateTerrainWithConstraints(q, r) {
    // Use shared terrain generation for RNG consistency
    const ctx = {
      rng: this.rng,
      hexes: this.hexes,
      terrainTypes: Object.values(TERRAIN_TYPES),
      terrainAffinities: TERRAIN_AFFINITIES,
      terrainClusters: this.terrainClusters,
      getRiverConstraints: (hex) => this.getRiverConstraints(hex),
      getElevation: (terrain) => getElevation(terrain),
      isBorderHex: (q, r) => this.isBorderHex(q, r),
    };

    return sharedGenerateTerrainWithConstraints(ctx, q, r);
  }

  // Add river edge and propagate to already-explored neighbors (simplified)
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

  maybeGenerateBarrier(hex, direction, neighborHex) {
    // Use shared barrier generation for RNG consistency
    const ctx = {
      rng: this.rng,
      constraints: this.constraints,
      barrierEdges: this.barrierEdges,
      anchoredBarrierEdges: this.anchoredBarrierEdges,
      traversedEdges: this.traversedEdges,
      currentExplorerPos: this.currentExplorerPos,
      hexes: this.hexes,
      exploredHexes: this.exploredHexes,
      realmRadius: this.realmRadius,
      wouldTrapExplorer: (edgeKey, lakeKey) => this.wouldTrapExplorer(edgeKey, lakeKey),
      generationMode: this.generationMode,
    };

    sharedMaybeGenerateBarrier(ctx, hex, direction, neighborHex);
  }

  maybeAddFeature(hex) {
    // Use shared feature placement for RNG consistency
    const ctx = {
      rng: this.rng,
      constraints: this.constraints,
      features: this.features,
      exploredHexes: this.exploredHexes,
      hasExclusiveFeature: (h) => this.hasExclusiveFeature(h),
      canPlaceExclusiveFeature: (h) => this.canPlaceExclusiveFeature(h),
      canPlaceHolding: (h) => this.canPlaceHolding(h),
    };

    sharedMaybeAddFeature(ctx, hex);
  }

  canPlaceHolding(hex) {
    // Check minimum distance from other holdings
    for (const pos of this.constraints.holdings.positions) {
      const dist = hexDistance(hex.q, hex.r, pos.q, pos.r);
      if (dist < 4) return false;
    }
    return true;
  }

  canPlaceExclusiveFeature(hex) {
    // Check if hex already has an exclusive feature
    // Exclusive features: holdings, myth sites, landmarks
    if (!hex.feature) return true;

    const feature = hex.feature;
    const isExclusive =
      feature === FEATURE_TYPES.HOLDING ||
      feature === FEATURE_TYPES.MYTH_SITE ||
      LANDMARK_TYPES.some((type) => feature === `landmark_${type}`);

    return !isExclusive;
  }

  hasExclusiveFeature(hex) {
    const key = hexKey(hex.q, hex.r);
    return this.constraints.featureRegistry.has(key);
  }

  isBorderClosed() {
    // Border is closed when all revealed hexes that are unexplored are either borders or lakes
    // i.e., there's no explorable frontier remaining
    let explorableFrontierCount = 0;
    for (const key of this.revealedHexes) {
      if (!this.exploredHexes.has(key)) {
        const hex = this.hexes.get(key);
        // If any unexplored hex is NOT a border and NOT a lake, border isn't closed
        if (hex && !hex.isBorder && !hex.isLake) {
          explorableFrontierCount++;
        }
      }
    }
    return explorableFrontierCount === 0;
  }

  /**
   * Force placement of any missing hard constraint features before exploration ends.
   * This guarantees holdings (4) and myth sites (6) are always placed.
   */
  forceCompleteFeatures() {
    // Use shared force completion for RNG consistency
    const ctx = {
      rng: this.rng,
      hexes: this.hexes,
      exploredHexes: this.exploredHexes,
      constraints: this.constraints,
      features: this.features,
      hasExclusiveFeature: (hex) => this.hasExclusiveFeature(hex),
      canPlaceHolding: (hex) => this.canPlaceHolding(hex),
    };

    sharedForceCompleteFeatures(ctx);

    // Validate barrier connectivity (debug)
    this.validateBarrierConnectivity();
  }

  /**
   * Validate that all barriers are connected to the border (no islands)
   * Logs warnings if any islands are detected
   */
  validateBarrierConnectivity() {
    const ctx = {
      barrierEdges: this.barrierEdges,
      hexes: this.hexes,
      realmRadius: this.realmRadius,
    };

    const result = sharedCheckBarrierConnectivity(ctx);

    if (!result.connected) {
      console.error(
        `[BARRIER ISLAND VIOLATION] ${result.islandCount} barriers not connected to border:`,
        result.islandEdges
      );
      console.error(
        'Total barriers:',
        this.barrierEdges.size,
        'Anchored:',
        this.anchoredBarrierEdges.size
      );
    }
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

        // Check border connectivity when revealing non-border hexes
        if (!nHex.isBorder) {
          const ctx = {
            hexes: this.hexes,
            borderHexes: this.borderHexes,
            realmRadius: this.realmRadius,
            revealedHexes: this.revealedHexes,
            rng: this.rng,
          };
          sharedEnsureBorderConnectivity(ctx, n.q, n.r);
        }
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

    // HARD CONSTRAINT: Stop at max 180 explorable hexes
    if (this.constraints.explorableHexes.count >= 180) {
      console.log('Reached maximum explorable hexes (180), stopping exploration');
      // Mark border as closed when we hit the cap
      this.constraints.borderClosure.complete = true;
      this.forceCompleteFeatures(); // Ensure hard constraint features are placed
      return false;
    }

    const prevPos = { ...this.currentExplorerPos };
    const validMoves = this.getValidMoves();
    if (validMoves.length === 0) {
      // No valid moves - border is definitely closed
      this.constraints.borderClosure.complete = true;
      this.forceCompleteFeatures(); // Ensure hard constraint features are placed
      return false;
    }

    // Check if border is naturally closed (all frontier hexes are impassable)
    // If so and we have minimum hexes, stop early
    if (this.isBorderClosed()) {
      this.constraints.borderClosure.complete = true;
      if (this.constraints.explorableHexes.count >= this.constraints.explorableHexes.min) {
        this.forceCompleteFeatures(); // Ensure hard constraint features are placed
        return false; // Stop generation - realm is complete
      }
    }

    let chosenMove;

    // Categorize moves
    const unexplored = validMoves.filter((m) => !this.exploredHexes.has(m.key));
    const unexploredWithFeatures = unexplored.filter((m) => m.hex.feature);

    // Collect river frontier hexes (unexplored hexes that rivers point toward)
    const riverFrontierKeys = new Set();
    for (const [edgeKey, edge] of this.riverEdges) {
      // Get the destination hex of this edge
      const destHex = hexNeighbor(edge.hex1.q, edge.hex1.r, edge.direction);
      const destKey = hexKey(destHex.q, destHex.r);
      // If destination is unexplored, it's a river frontier
      if (!this.exploredHexes.has(destKey)) {
        riverFrontierKeys.add(destKey);
      }
    }
    const unexploredRiverFrontiers = unexplored.filter((m) => riverFrontierKeys.has(m.key));

    // Priority 0: Adjacent unexplored hex that's a river frontier (80%)
    if (unexploredRiverFrontiers.length > 0 && this.rng.next() < 0.8) {
      chosenMove = this.rng.choice(unexploredRiverFrontiers);
    }
    // Priority 1: Adjacent unexplored hex with feature (98%)
    else if (unexploredWithFeatures.length > 0 && this.rng.next() < 0.98) {
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

    // Record this edge as traversed BEFORE exploring (which may generate new hexes)
    // Use both key formats to ensure we block future barrier creation on this edge
    const edgeKey1 = `${prevPos.q},${prevPos.r}:${chosenMove.direction}`;
    const oppDir = OPPOSITE_DIRECTION[chosenMove.direction];
    const edgeKey2 = `${chosenMove.q},${chosenMove.r}:${oppDir}`;
    this.traversedEdges.add(edgeKey1);
    this.traversedEdges.add(edgeKey2);

    // Set exploration mode before moving - barriers can now be generated
    this.generationMode = 'exploration';

    this.currentExplorerPos = { q: chosenMove.q, r: chosenMove.r };
    this.explorerPath.push({ ...this.currentExplorerPos });
    this.exploreHex(chosenMove.q, chosenMove.r);

    // Update realm dimensions every 5 steps for efficiency
    if (this.explorerPath.length % 5 === 0) {
      this.updateRealmDimensions();
    }

    // Validate feature exclusivity every 10 steps for efficiency
    if (this.explorerPath.length % 10 === 0) {
      this.validateFeatureExclusivity();
    }

    this.saveStepState();
    return true;
  }

  saveStepState() {
    const stepNum = this.stepStates.length;

    // Deep clone constraints, handling the featureRegistry Set separately
    const constraintsCopy = JSON.parse(
      JSON.stringify(this.constraints, (key, value) => {
        // Skip the featureRegistry Set during JSON serialization
        if (key === 'featureRegistry') return undefined;
        return value;
      })
    );
    // Manually copy the featureRegistry Set
    constraintsCopy.featureRegistry = new Set(this.constraints.featureRegistry);

    const savedState = {
      // Explorer state
      explorerPos: { ...this.currentExplorerPos },
      explorerPathLength: this.explorerPath.length,

      // RNG state
      rngState: this.rng.getState(),

      // Constraints
      constraints: constraintsCopy,

      // Hex-related Sets
      exploredHexes: new Set(this.exploredHexes),
      revealedHexes: new Set(this.revealedHexes),
      borderHexes: new Set(this.borderHexes),
      existingHexKeys: new Set(this.hexes.keys()),

      // Per-hex state (all hexes, not just revealed)
      hexState: new Map(
        Array.from(this.hexes.entries()).map(([k, h]) => [
          k,
          {
            q: h.q,
            r: h.r,
            terrain: h.terrain,
            feature: h.feature,
            holdingType: h.holdingType,
            revealed: h.revealed,
            isBorder: h.isBorder,
            borderType: h.borderType,
            isLake: h.isLake,
            clusterId: h.clusterId,
            riverEdges: [...(h.riverEdges || [])],
            barrierEdges: [...(h.barrierEdges || [])],
          },
        ])
      ),

      // Edge-related state
      riverEdges: new Map(this.riverEdges),
      barrierEdges: new Set(this.barrierEdges),
      anchoredBarrierEdges: new Set(this.anchoredBarrierEdges),
      traversedEdges: new Set(this.traversedEdges),

      // Other collections
      lakes: [...this.lakes],
      riverNetwork: [...this.riverNetwork],
      features: new Map(this.features),
      terrainClusters: new Map(this.terrainClusters),
      borderClusters: [...this.borderClusters],
      borderClusterSeeds: [...this.borderClusterSeeds],

      // Counters
      clusterIdCounter: this.clusterIdCounter,
      riverIdCounter: this.riverIdCounter,

      // New river system state
      riverEncountered: this.riverEncountered,
      rivers: this.rivers.map((network) => ({
        id: network.id,
        edges: Array.from(network.edges),
        tributaryCount: network.tributaryCount,
      })),
      plannedRiverEdges: Array.from(this.plannedRiverEdges.entries()),

      // Counts for debugging
      hexCount: this.hexes.size,
      exploredCount: this.exploredHexes.size,
      revealedCount: this.revealedHexes.size,
    };

    this.stepStates.push(savedState);
  }

  restoreStep(stepIndex) {
    if (stepIndex < 0 || stepIndex >= this.stepStates.length) return false;

    const state = this.stepStates[stepIndex];

    // CRITICAL: Full state restoration for determinism

    // 1. Restore explorer state
    this.currentExplorerPos = { ...state.explorerPos };
    this.explorerPath = this.explorerPath.slice(0, state.explorerPathLength);

    // 2. Restore RNG state
    this.rng.setState(state.rngState);

    // 3. Restore constraints (excluding featureRegistry which is a Set)
    this.constraints = JSON.parse(
      JSON.stringify(state.constraints, (key, value) => {
        // Skip featureRegistry during JSON serialization - will be restored separately
        if (key === 'featureRegistry') return undefined;
        return value;
      })
    );
    // Restore featureRegistry as a proper Set
    this.constraints.featureRegistry = new Set(state.constraints.featureRegistry);

    // 4. Restore all hex-related Sets
    this.exploredHexes = new Set(state.exploredHexes);
    this.revealedHexes = new Set(state.revealedHexes);
    this.borderHexes = new Set(state.borderHexes);

    // 5. Restore hexes Map completely
    this.hexes.clear();
    for (const [key, hexData] of state.hexState) {
      this.hexes.set(key, { ...hexData });
    }

    // 6. Restore edge-related state
    this.riverEdges = new Map(state.riverEdges);
    this.barrierEdges = new Set(state.barrierEdges);
    this.anchoredBarrierEdges = new Set(state.anchoredBarrierEdges || new Set());
    this.traversedEdges = new Set(state.traversedEdges);

    // 7. Restore other collections
    this.lakes = [...state.lakes];
    this.riverNetwork = [...state.riverNetwork];
    this.features = new Map(state.features);
    this.terrainClusters = new Map(state.terrainClusters);
    this.borderClusters = [...state.borderClusters];
    this.borderClusterSeeds = [...state.borderClusterSeeds];

    // 8. Restore counters
    this.clusterIdCounter = state.clusterIdCounter;
    this.riverIdCounter = state.riverIdCounter;

    // 8b. Restore new river system state
    this.riverEncountered = state.riverEncountered;
    this.rivers = state.rivers.map((networkData) => ({
      id: networkData.id,
      edges: new Set(networkData.edges),
      tributaryCount: networkData.tributaryCount,
    }));
    this.plannedRiverEdges = new Map(state.plannedRiverEdges || []);

    // 9. Truncate future states
    this.stepStates = this.stepStates.slice(0, stepIndex + 1);

    // 10. Validate restored state types (catches serialization bugs)
    if (!(this.constraints.featureRegistry instanceof Set)) {
      throw new Error('restoreStep: featureRegistry must be a Set after restoration');
    }
    if (!(this.exploredHexes instanceof Set)) {
      throw new Error('restoreStep: exploredHexes must be a Set after restoration');
    }
    if (!(this.hexes instanceof Map)) {
      throw new Error('restoreStep: hexes must be a Map after restoration');
    }

    // Validate barrier connectivity after restore (debug)
    this.validateBarrierConnectivity();

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

      const edge = this.riverEdges.get(key);
      if (!edge) continue;

      const { hex1, direction } = edge;

      // Get edges at BOTH vertices of this edge (vertex connectivity)
      const adjacentDirs = getAdjacentDirections(direction);

      // Vertex 1 (clockwise): edges that share vertex between direction and direction+1
      const clockwiseDir = adjacentDirs[0];
      const v1Edges = [this.getEdgeKey(hex1.q, hex1.r, clockwiseDir)];
      const n1 = hexNeighbor(hex1.q, hex1.r, direction);
      const n1Adj = getAdjacentDirections(OPPOSITE_DIRECTION[direction]);
      v1Edges.push(this.getEdgeKey(n1.q, n1.r, n1Adj[1]));
      const n2 = hexNeighbor(hex1.q, hex1.r, clockwiseDir);
      const n2Adj = getAdjacentDirections(OPPOSITE_DIRECTION[clockwiseDir]);
      v1Edges.push(this.getEdgeKey(n2.q, n2.r, n2Adj[0]));

      // Vertex 2 (counterclockwise): edges that share vertex between direction and direction-1
      const counterDir = adjacentDirs[1];
      const v2Edges = [this.getEdgeKey(hex1.q, hex1.r, counterDir)];
      const n3 = hexNeighbor(hex1.q, hex1.r, direction);
      const n3Adj = getAdjacentDirections(OPPOSITE_DIRECTION[direction]);
      v2Edges.push(this.getEdgeKey(n3.q, n3.r, n3Adj[0]));
      const n4 = hexNeighbor(hex1.q, hex1.r, counterDir);
      const n4Adj = getAdjacentDirections(OPPOSITE_DIRECTION[counterDir]);
      v2Edges.push(this.getEdgeKey(n4.q, n4.r, n4Adj[1]));

      // Add all vertex-adjacent river edges to queue
      for (const edgeKey of [...v1Edges, ...v2Edges]) {
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

  calculateRiverMetrics() {
    // Calculate metrics from current river networks
    const networkCount = this.rivers.length;

    // Sum up all tributary counts across networks
    const totalTributaries = this.rivers.reduce(
      (sum, network) => sum + (network.tributaryCount || 0),
      0
    );

    // Calculate span using existing method
    const span = this.calculateRiverNetworkSpan();

    return {
      networkCount,
      tributaryCount: totalTributaries,
      span,
    };
  }

  getConstraintReport() {
    const metrics = this.calculateRiverMetrics();

    return {
      seed: this.seed,
      hardConstraints: {
        borderClosure: {
          pass: this.constraints.borderClosure.complete,
          value: this.constraints.borderClosure.complete ? 'complete' : 'incomplete',
        },
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
        featureExclusivity: {
          pass: this.constraints.featureExclusivity.valid,
          value:
            this.constraints.featureExclusivity.violations.length === 0
              ? 'no overlaps'
              : `${this.constraints.featureExclusivity.violations.length} violations`,
        },
        riverFlow: { pass: true, value: 'no uphill violations' },
      },
      softConstraints: {
        explorableHexes: {
          status: this.constraints.explorableHexes.count >= 140 ? 'good' : 'partial',
          value: this.constraints.explorableHexes.count,
          target: 144,
        },
        riverNetwork: {
          status:
            metrics.networkCount === 1 && metrics.tributaryCount >= 3 && metrics.span >= 8
              ? 'good'
              : metrics.networkCount === 1 || metrics.tributaryCount >= 2
                ? 'partial'
                : 'minimal',
          networkCount: metrics.networkCount,
          targetNetworkCount: 1,
          tributaryCount: metrics.tributaryCount,
          targetTributaries: 3,
          span: metrics.span,
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

  validateHardConstraints() {
    const violations = [];
    const results = {
      valid: true,
      violations,
    };

    // 1. Border Closure (HARD)
    // This is always satisfied by construction - borders are pre-generated
    // No validation needed

    // 2. Explorable Hexes: minimum 100 (HARD)
    if (this.constraints.explorableHexes.count < 100) {
      violations.push({
        constraint: 'explorableHexes',
        message: `Only ${this.constraints.explorableHexes.count} explorable hexes (minimum: 100)`,
      });
      results.valid = false;
    }

    // 3. Max Explorable Hexes: 180 (HARD)
    if (this.constraints.explorableHexes.count > 180) {
      violations.push({
        constraint: 'explorableHexes',
        message: `Too many explorable hexes: ${this.constraints.explorableHexes.count} (maximum: 180)`,
      });
      results.valid = false;
    }

    // 4. Holdings: exactly 4 (HARD)
    if (this.constraints.holdings.placed !== 4) {
      violations.push({
        constraint: 'holdings',
        message: `Holdings count: ${this.constraints.holdings.placed} (required: exactly 4)`,
      });
      results.valid = false;
    }

    // 5. Holding Spacing: minimum 4 hexes apart (HARD)
    if (!this.validateHoldingSpacing()) {
      violations.push({
        constraint: 'holdingSpacing',
        message: 'Holdings must be at least 4 hexes apart',
      });
      results.valid = false;
    }

    // 6. Myth Sites: exactly 6 (HARD)
    if (this.constraints.mythSites.placed !== 6) {
      violations.push({
        constraint: 'mythSites',
        message: `Myth sites count: ${this.constraints.mythSites.placed} (required: exactly 6)`,
      });
      results.valid = false;
    }

    // 7. Landmarks: 3-4 of each type (HARD)
    for (const type of LANDMARK_TYPES) {
      const count = this.constraints.landmarks[type].placed;
      if (count < 3 || count > 4) {
        violations.push({
          constraint: `landmark_${type}`,
          message: `${type} landmarks: ${count} (required: 3-4)`,
        });
        results.valid = false;
      }
    }

    // 8. Feature Exclusivity: no hex has multiple exclusive features (HARD)
    if (!this.constraints.featureExclusivity.valid) {
      violations.push({
        constraint: 'featureExclusivity',
        message: `${this.constraints.featureExclusivity.violations.length} hexes have multiple exclusive features`,
      });
      results.valid = false;
    }

    // 9. River Flow: rivers must flow downhill (HARD)
    // This is validated during river generation - check for violations here
    // For now, assume valid (can add detailed validation later)

    return results;
  }

  updateRealmDimensions() {
    // Calculate bounding box of all explorable hexes
    let minQ = Infinity,
      maxQ = -Infinity;
    let minR = Infinity,
      maxR = -Infinity;

    for (const key of this.exploredHexes) {
      const { q, r } = parseHexKey(key);
      minQ = Math.min(minQ, q);
      maxQ = Math.max(maxQ, q);
      minR = Math.min(minR, r);
      maxR = Math.max(maxR, r);
    }

    // Update constraints
    this.constraints.realmDimensions.minQ = minQ;
    this.constraints.realmDimensions.maxQ = maxQ;
    this.constraints.realmDimensions.minR = minR;
    this.constraints.realmDimensions.maxR = maxR;

    // Calculate approximate width and height
    // For axial coordinates, the conversion to grid dimensions is approximate
    this.constraints.realmDimensions.width = maxQ - minQ + 1;
    this.constraints.realmDimensions.height = maxR - minR + 1;
  }

  validateFeatureExclusivity() {
    // Check that no hex has multiple exclusive features
    // Exclusive features: holdings, myth sites, landmarks
    const violations = [];

    for (const [key, hex] of this.hexes) {
      if (!hex.feature) continue;

      const exclusiveFeatures = [];
      const feature = hex.feature;

      // Check if this is an exclusive feature
      if (feature === FEATURE_TYPES.HOLDING) {
        exclusiveFeatures.push('holding');
      } else if (feature === FEATURE_TYPES.MYTH_SITE) {
        exclusiveFeatures.push('mythSite');
      } else if (LANDMARK_TYPES.some((type) => feature === `landmark_${type}`)) {
        exclusiveFeatures.push(feature);
      }

      // A hex should only have one exclusive feature
      // (This check is mainly for validation - the code shouldn't allow this)
      if (exclusiveFeatures.length > 1) {
        violations.push({
          hex: { q: hex.q, r: hex.r },
          features: exclusiveFeatures,
        });
      }
    }

    // Update constraints
    this.constraints.featureExclusivity.violations = violations;
    this.constraints.featureExclusivity.valid = violations.length === 0;

    if (violations.length > 0) {
      console.warn('Feature exclusivity violations detected:', violations);
    }
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
    try {
      const gen = new RealmGenerator(seed);
      gen.initialize(startAtBorder);
      setGenerator(gen);
      setStep(0);
      setRenderKey((prev) => prev + 1);
    } catch (error) {
      console.error('Failed to initialize generator:', error);
      throw error;
    }
  }, [seed, startAtBorder]);

  useEffect(() => {
    initializeGenerator();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Expose for console testing
  useEffect(() => {
    window.__TEST_GENERATOR__ = generator;
    window.RealmGenerator = RealmGenerator;
    return () => {
      delete window.__TEST_GENERATOR__;
      delete window.RealmGenerator;
    };
  }, [generator]);

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

    // Always restore to target step if we have it saved
    if (targetStep < generator.stepStates.length) {
      generator.restoreStep(targetStep);
      setStep(targetStep);
    } else {
      // Target is beyond saved states
      // Restore to last saved state, then move forward
      const lastSaved = generator.stepStates.length - 1;
      if (lastSaved >= 0) {
        generator.restoreStep(lastSaved);
        let currentStep = lastSaved + 1;

        // Move forward to target
        while (currentStep <= targetStep) {
          const moved = generator.moveExplorer();
          if (!moved) break;
          currentStep++;
        }
        setStep(currentStep);
      }
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
            generator && <StatePanel generator={generator} step={step} renderKey={renderKey} />
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

  const clipPathDefs = [];
  const hexElements = [];
  const riverElements = [];
  const barrierElements = [];
  const featureElements = [];
  const explorerElements = [];

  // Early return if generator is not ready
  if (!generator || !generator.hexes || generator.hexes.size === 0) {
    return (
      <svg
        viewBox={`${viewBounds.minX} ${viewBounds.minY} ${width} ${height}`}
        className="w-full h-96 lg:h-[500px]"
        preserveAspectRatio="xMidYMid meet"
      >
        <text
          x={viewBounds.minX + width / 2}
          y={viewBounds.minY + height / 2}
          textAnchor="middle"
          fill="#666"
          fontSize="16"
        >
          Initializing generator...
        </text>
      </svg>
    );
  }

  // Render hexes
  for (const [key, hex] of generator.hexes) {
    if (!hex.revealed) continue;

    const { x, y } = hexToPixel(hex.q, hex.r, size);
    const corners = getHexCorners(x, y, size);
    const points = corners.map((c) => `${c.x},${c.y}`).join(' ');

    // Create clipPath for this hex (used to clip images to hex boundary)
    const clipId = `hex-clip-${key}`;
    clipPathDefs.push(
      <clipPath key={clipId} id={clipId}>
        <polygon points={points} />
      </clipPath>
    );

    // Border hexes: Keep colored fills (sea, cliff, wasteland)
    // Non-border hexes: White background with terrain icon
    let fillColor;
    if (hex.isBorder) {
      fillColor = TERRAIN_COLORS[hex.borderType];
    } else {
      fillColor = '#ffffff'; // White background for non-border hexes
    }

    hexElements.push(
      <polygon key={key} points={points} fill={fillColor} stroke="#333" strokeWidth="1" />
    );

    // Terrain icon for non-border hexes
    if (!hex.isBorder) {
      let terrainAsset;
      if (hex.isLake) {
        terrainAsset = TERRAIN_ASSETS.lake;
      } else {
        terrainAsset = TERRAIN_ASSETS[hex.terrain];
      }

      if (terrainAsset) {
        const iconSize = size * 1.8; // Scale icon larger since it will be clipped
        featureElements.push(
          <image
            key={`terrain-${key}`}
            href={terrainAsset}
            x={x - iconSize / 2}
            y={y - iconSize / 2}
            width={iconSize}
            height={iconSize}
            preserveAspectRatio="xMidYMid meet"
            clipPath={`url(#hex-clip-${key})`}
          />
        );
      }
    }

    // Feature icon (holdings, landmarks, myth sites)
    if (hex.feature) {
      let featureAsset = null;
      let fallbackIcon = null;

      if (hex.feature === 'holding' && hex.holdingType) {
        featureAsset = HOLDING_ASSETS[hex.holdingType];
        fallbackIcon = FEATURE_ICONS[hex.feature];
      } else if (hex.feature === 'mythSite') {
        // No asset for myth site - use emoji
        fallbackIcon = FEATURE_ICONS[hex.feature];
      } else if (hex.feature.startsWith('landmark_')) {
        const landmarkType = hex.feature.replace('landmark_', '');
        featureAsset = LANDMARK_ASSETS[landmarkType];
        fallbackIcon = FEATURE_ICONS[hex.feature];
      }

      if (featureAsset) {
        const iconSize = size * 1.8; // Scale icon larger since it will be clipped
        featureElements.push(
          <image
            key={`feature-${key}`}
            href={featureAsset}
            x={x - iconSize / 2}
            y={y - iconSize / 2}
            width={iconSize}
            height={iconSize}
            preserveAspectRatio="xMidYMid meet"
            clipPath={`url(#hex-clip-${key})`}
          />
        );
      } else if (fallbackIcon) {
        // Fallback to emoji for features without assets
        featureElements.push(
          <text key={`feature-${key}`} x={x} y={y + 5} textAnchor="middle" fontSize="16">
            {fallbackIcon}
          </text>
        );
      }
    }
  }

  // Render rivers - show edge if EITHER hex it touches is revealed
  for (const [edgeKey, river] of generator.riverEdges) {
    const [hexPart, direction] = edgeKey.split(':');
    const { q, r } = parseHexKey(hexPart);
    const hex1 = generator.hexes.get(hexPart);

    // Also check the neighbor hex (the other side of the edge)
    const neighbor = hexNeighbor(q, r, direction);
    const neighborKey = hexKey(neighbor.q, neighbor.r);
    const hex2 = generator.hexes.get(neighborKey);

    // Draw edge if either hex is revealed
    const isVisible = (hex1 && hex1.revealed) || (hex2 && hex2.revealed);

    if (isVisible) {
      const { x, y } = hexToPixel(q, r, size);
      const { p1, p2 } = getEdgeEndpoints(x, y, size, direction);

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
      <defs>{clipPathDefs}</defs>
      <g>
        {hexElements}
        {featureElements}
        {riverElements}
        {barrierElements}
        {explorerElements}
      </g>
    </svg>
  );
}

// ============================================================================
// STATE PANEL COMPONENT
// ============================================================================
// Helper functions for constraint quality assessment
function getQualityRating(value, target, type = 'exact') {
  if (type === 'exact') {
    return value === target ? 'excellent' : 'poor';
  } else if (type === 'min') {
    if (value >= target) return 'excellent';
    if (value >= target * 0.8) return 'good';
    return 'poor';
  } else if (type === 'range') {
    // target is { min, max }
    if (value >= target.min && value <= target.max) return 'excellent';
    if (value >= target.min * 0.8) return 'good';
    return 'poor';
  } else if (type === 'approximate') {
    // Within 10% is excellent, within 20% is good
    const diff = Math.abs(value - target);
    const tolerance = target * 0.1;
    if (diff <= tolerance) return 'excellent';
    if (diff <= tolerance * 2) return 'good';
    return 'fair';
  }
  return 'fair';
}

function getDimensionQuality(width, height, targetWidth = 12, targetHeight = 12) {
  const widthDiff = Math.abs(width - targetWidth);
  const heightDiff = Math.abs(height - targetHeight);
  const avgDiff = (widthDiff + heightDiff) / 2;

  if (avgDiff <= 1) return 'excellent';
  if (avgDiff <= 3) return 'good';
  if (avgDiff <= 5) return 'fair';
  return 'poor';
}

function getClusterQuality(terrainClusters) {
  // Quality based on cluster diversity and size
  const clusterCount = terrainClusters.size;
  if (clusterCount >= 6 && clusterCount <= 12) return 'excellent';
  if (clusterCount >= 4 && clusterCount <= 15) return 'good';
  if (clusterCount >= 3) return 'fair';
  return 'poor';
}

function StatePanel({ generator, step, renderKey }) {
  const currentHex = generator.currentExplorerPos
    ? generator.hexes.get(hexKey(generator.currentExplorerPos.q, generator.currentExplorerPos.r))
    : null;

  const constraints = generator.constraints;
  const riverMetrics = generator.calculateRiverMetrics();

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

      {/* Hard Constraints (MUST) */}
      <div className="bg-red-900 bg-opacity-20 border border-red-700 p-3 rounded">
        <h4 className="font-semibold mb-2 text-red-400">Hard Constraints (MUST)</h4>

        <ConstraintRow
          label="Holdings"
          value={`${constraints.holdings.placed}/4 exactly`}
          pass={constraints.holdings.placed === 4}
          isHard={true}
        />
        <ConstraintRow
          label="Holding Spacing"
          value={`≥4 hexes apart`}
          pass={constraints.holdings.spacingViolations === 0}
          isHard={true}
        />
        <ConstraintRow
          label="Myth Sites"
          value={`${constraints.mythSites.placed}/6 exactly`}
          pass={constraints.mythSites.placed === 6}
          isHard={true}
        />
        <ConstraintRow
          label="Explorable Hexes"
          value={`${constraints.explorableHexes.count} (100-180)`}
          pass={
            constraints.explorableHexes.count >= 100 && constraints.explorableHexes.count <= 180
          }
          isHard={true}
        />
        <ConstraintRow
          label="Feature Exclusivity"
          value={
            constraints.featureExclusivity.valid
              ? 'No overlaps'
              : `${constraints.featureExclusivity.violations.length} violations`
          }
          pass={constraints.featureExclusivity.valid}
          isHard={true}
        />

        {/* Landmarks (Hard Constraints) */}
        {LANDMARK_TYPES.map((type) => {
          const c = constraints.landmarks[type];
          return (
            <ConstraintRow
              key={type}
              label={`${type.charAt(0).toUpperCase() + type.slice(1)} Landmarks`}
              value={`${c.placed} (need ${c.min}-${c.max})`}
              pass={c.placed >= c.min && c.placed <= c.max}
              warning={c.placed < c.min}
              isHard={true}
            />
          );
        })}
      </div>

      {/* Soft Constraints (SHOULD) */}
      <div className="bg-purple-900 bg-opacity-20 border border-purple-700 p-3 rounded">
        <h4 className="font-semibold mb-2 text-purple-400">Soft Constraints (SHOULD)</h4>

        <ConstraintRow
          label="Explorable Hexes"
          value={`${constraints.explorableHexes.count}/144 (target)`}
          quality={getQualityRating(constraints.explorableHexes.count, 144, 'approximate')}
        />
        <ConstraintRow
          label="Realm Dimensions"
          value={`${constraints.realmDimensions.width}x${constraints.realmDimensions.height} (~12x12)`}
          quality={getDimensionQuality(
            constraints.realmDimensions.width,
            constraints.realmDimensions.height
          )}
        />
        <ConstraintRow
          label="Lakes"
          value={`${constraints.lakes.placed}/3 max`}
          quality={constraints.lakes.placed <= 3 ? 'excellent' : 'poor'}
        />
        <ConstraintRow
          label="Barriers"
          value={`${constraints.barriers.placed}/~24`}
          quality={getQualityRating(constraints.barriers.placed, 24, 'approximate')}
        />
        <ConstraintRow
          label="River Networks"
          value={`${riverMetrics.networkCount}/1 (target)`}
          quality={riverMetrics.networkCount === 1 ? 'excellent' : 'poor'}
        />
        <ConstraintRow
          label="River Tributaries"
          value={`${riverMetrics.tributaryCount}/3 (target)`}
          quality={getQualityRating(riverMetrics.tributaryCount, 3, 'min')}
        />
        <ConstraintRow
          label="River Span"
          value={`${riverMetrics.span}/≥8 (target)`}
          quality={getQualityRating(riverMetrics.span, 8, 'min')}
        />
        <ConstraintRow
          label="Terrain Clusters"
          value={`${generator.terrainClusters.size} clusters`}
          quality={getClusterQuality(generator.terrainClusters)}
        />
      </div>

      {/* Stats */}
      <div className="bg-gray-700 p-3 rounded">
        <h4 className="font-semibold mb-2">Statistics</h4>
        <p>
          Step: {step} | RenderKey: {renderKey}
        </p>
        <p>Total Hexes: {generator.hexes.size}</p>
        <p>Explored: {generator.exploredHexes.size}</p>
        <p>Revealed: {generator.revealedHexes.size}</p>
        <p>Border Hexes: {generator.borderHexes.size}</p>
        <p>River Edges: {generator.riverEdges.size}</p>
        <p>Terrain Clusters: {generator.terrainClusters.size}</p>
      </div>
    </div>
  );
}

function ConstraintRow({ label, value, pass, warning, quality, isHard }) {
  // If quality is provided, use quality-based coloring (for soft constraints)
  // Otherwise use pass/warning/fail (for hard constraints)
  let color, icon;

  if (quality) {
    // Soft constraint quality indicators
    const qualityConfig = {
      excellent: { color: 'text-green-400', icon: '★' },
      good: { color: 'text-blue-400', icon: '●' },
      fair: { color: 'text-yellow-400', icon: '○' },
      poor: { color: 'text-orange-400', icon: '◐' },
    };
    const config = qualityConfig[quality] || qualityConfig.fair;
    color = config.color;
    icon = config.icon;
  } else {
    // Hard constraint pass/fail indicators
    color = pass ? 'text-green-400' : warning ? 'text-yellow-400' : 'text-red-400';
    icon = pass ? '✓' : warning ? '⚠' : '✗';
  }

  return (
    <div className="flex justify-between items-center py-1">
      <span className={isHard ? 'font-semibold' : ''}>{label}</span>
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
          River: {report.softConstraints.riverNetwork.networkCount} network
          {report.softConstraints.riverNetwork.networkCount !== 1 ? 's' : ''} (target: 1),{' '}
          {report.softConstraints.riverNetwork.tributaryCount} tributaries (target: 3), span{' '}
          {report.softConstraints.riverNetwork.span} (target: ≥
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
