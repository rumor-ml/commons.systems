/**
 * Terrain Constants
 *
 * Shared terrain types, affinities, and elevation values used by both
 * UI (MythicBastionlandRealms.jsx) and simulator (constraint-simulator.mjs).
 *
 * IMPORTANT: Any changes here affect RNG consumption order and will change
 * map generation results across all seeds.
 */

export const TERRAIN_TYPES = {
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

export const TERRAIN_AFFINITIES = {
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

export const ELEVATION = {
  [TERRAIN_TYPES.PEAKS]: 3,
  [TERRAIN_TYPES.HILLS]: 2,
  [TERRAIN_TYPES.CRAG]: 2,
  default: 1,
};

/**
 * Get elevation for a terrain type
 */
export function getElevation(terrain) {
  return ELEVATION[terrain] || ELEVATION.default || 1;
}

export const BORDER_TYPES = {
  SEA: 'sea',
  CLIFF: 'cliff',
  WASTELAND: 'wasteland',
};

export const FEATURE_TYPES = {
  HOLDING: 'holding',
  MYTH_SITE: 'mythSite',
  LANDMARK: 'landmark',
};

export const HOLDING_TYPES = {
  TOWER: 'tower',
  TOWN: 'town',
  CASTLE: 'castle',
  FORTRESS: 'fortress',
};

export const LANDMARK_TYPES = {
  CURSE: 'curse',
  DWELLING: 'dwelling',
  HAZARD: 'hazard',
  MONUMENT: 'monument',
  RUIN: 'ruin',
  SANCTUM: 'sanctum',
};

/**
 * Asset paths for terrain types
 */
export const TERRAIN_ASSETS = {
  [TERRAIN_TYPES.FOREST]: '/assets/terrain-forest.png',
  [TERRAIN_TYPES.GLADE]: '/assets/terrain-glade.png',
  [TERRAIN_TYPES.MARSH]: '/assets/terrain-marsh.png',
  [TERRAIN_TYPES.BOG]: '/assets/terrain-bog.png',
  [TERRAIN_TYPES.HEATH]: '/assets/terrain-heath.png',
  [TERRAIN_TYPES.PLAINS]: '/assets/terrain-plains.png',
  [TERRAIN_TYPES.VALLEY]: '/assets/terrain-valley.png',
  [TERRAIN_TYPES.HILLS]: '/assets/terrain-hills.png',
  [TERRAIN_TYPES.CRAG]: '/assets/terrain-crag.png',
  [TERRAIN_TYPES.PEAKS]: '/assets/terrain-peaks.png',
  lake: '/assets/terrain-lake.png',
};

/**
 * Asset paths for holding types
 */
export const HOLDING_ASSETS = {
  [HOLDING_TYPES.CASTLE]: '/assets/holding-castle.png',
  [HOLDING_TYPES.FORTRESS]: '/assets/holding-fortress.png',
  [HOLDING_TYPES.TOWER]: '/assets/holding-tower.png',
  [HOLDING_TYPES.TOWN]: '/assets/holding-town.png',
};

/**
 * Asset paths for landmark types
 */
export const LANDMARK_ASSETS = {
  [LANDMARK_TYPES.CURSE]: '/assets/landmark-curses.png',
  [LANDMARK_TYPES.DWELLING]: '/assets/landmark-dwellings.png',
  [LANDMARK_TYPES.HAZARD]: '/assets/landmark-hazards.png',
  [LANDMARK_TYPES.MONUMENT]: '/assets/landmark-monuments.png',
  [LANDMARK_TYPES.SANCTUM]: '/assets/landmark-sanctums.png',
  [LANDMARK_TYPES.RUIN]: null, // No asset - use emoji fallback
};
