/**
 * Hex Math Utilities
 *
 * Provides functions for working with hexagonal grids using axial coordinates.
 * Assumes pointy-top orientation.
 */

// Direction constants
export const HEX_DIRECTIONS = {
  NE: { q: 1, r: -1 },
  E: { q: 1, r: 0 },
  SE: { q: 0, r: 1 },
  SW: { q: -1, r: 1 },
  W: { q: -1, r: 0 },
  NW: { q: 0, r: -1 },
};

export const DIRECTION_NAMES = ['NE', 'E', 'SE', 'SW', 'W', 'NW'];
export const OPPOSITE_DIRECTION = { NE: 'SW', E: 'W', SE: 'NW', SW: 'NE', W: 'E', NW: 'SE' };

/**
 * Calculate distance between two hexes (in hex units)
 */
export function hexDistance(q1, r1, q2, r2) {
  if (
    !Number.isInteger(q1) ||
    !Number.isInteger(r1) ||
    !Number.isInteger(q2) ||
    !Number.isInteger(r2)
  ) {
    throw new Error(`Hex coordinates must be integers: got q1=${q1}, r1=${r1}, q2=${q2}, r2=${r2}`);
  }
  return (Math.abs(q1 - q2) + Math.abs(q1 + r1 - q2 - r2) + Math.abs(r1 - r2)) / 2;
}

/**
 * Get neighboring hex coordinates in a given direction
 */
export function hexNeighbor(q, r, direction) {
  if (!Number.isInteger(q) || !Number.isInteger(r)) {
    throw new Error(`Hex coordinates must be integers: got q=${q}, r=${r}`);
  }
  const d = HEX_DIRECTIONS[direction];
  return { q: q + d.q, r: r + d.r };
}

/**
 * Get all 6 neighbors of a hex
 */
export function hexNeighbors(q, r) {
  return DIRECTION_NAMES.map((dir) => ({
    direction: dir,
    ...hexNeighbor(q, r, dir),
  }));
}

/**
 * Convert hex coordinates to a unique string key
 */
export function hexKey(q, r) {
  if (!Number.isInteger(q) || !Number.isInteger(r)) {
    throw new Error(`Hex coordinates must be integers: got q=${q}, r=${r}`);
  }
  return `${q},${r}`;
}

/**
 * Get the two directions adjacent to a given direction (share a vertex)
 */
export function getAdjacentDirections(dir) {
  const idx = DIRECTION_NAMES.indexOf(dir);
  const prev = DIRECTION_NAMES[(idx + 5) % 6]; // -1 with wrap
  const next = DIRECTION_NAMES[(idx + 1) % 6]; // +1 with wrap
  return [prev, next];
}

/**
 * Get the two edge directions that meet at a vertex
 * Vertices are numbered 0-5. Vertex N lies between edge N and edge N+1 (mod 6).
 * Example: Vertex 0 is between edges NE (index 0) and E (index 1)
 */
export function getVertexDirections(vertexIndex) {
  return [DIRECTION_NAMES[vertexIndex], DIRECTION_NAMES[(vertexIndex + 1) % 6]];
}

/**
 * Get the edge direction(s) needed to connect two vertices
 * Returns an array of edge directions (1-2 edges)
 */
export function getEdgesBetweenVertices(v1Index, v2Index) {
  const start = Math.min(v1Index, v2Index);
  const end = Math.max(v1Index, v2Index);

  const directDist = end - start;
  const wrapDist = 6 - directDist;

  if (directDist <= wrapDist) {
    // Go direct: edges at indices start+1 through end
    return Array.from({ length: directDist }, (_, i) => DIRECTION_NAMES[(start + 1 + i) % 6]);
  } else {
    // Wrap around: go the other way
    return Array.from({ length: wrapDist }, (_, i) => DIRECTION_NAMES[(end + 1 + i) % 6]);
  }
}

/**
 * Parse a hex key string into q,r coordinates
 */
export function parseHexKey(key) {
  const [q, r] = key.split(',').map(Number);
  return { q, r };
}
