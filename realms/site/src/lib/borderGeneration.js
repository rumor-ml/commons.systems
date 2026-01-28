/**
 * Border Generation Logic
 *
 * Provides border cluster initialization and probability calculation
 * for determining which hexes become border hexes.
 */

/**
 * Initialize border clusters for organic border shapes
 * @param {Object} rng - SeededRNG instance
 * @returns {Array} Array of cluster objects with {angle, strength}
 */
export function initializeBorderClusters(rng) {
  const clusters = [];
  const numClusters = 4;
  for (let i = 0; i < numClusters; i++) {
    const baseAngle = (i * Math.PI * 2) / numClusters;
    const angle = baseAngle + (rng.next() - 0.5) * (Math.PI / 3);
    const strength = 0.3 + rng.next() * 0.4;
    clusters.push({ angle, strength });
  }
  return clusters;
}

/**
 * Calculate probability of a hex being a border hex
 * @param {number} q - Hex q coordinate
 * @param {number} r - Hex r coordinate
 * @param {number} dist - Distance from origin
 * @param {Array} borderClusters - Cluster array from initializeBorderClusters()
 * @returns {number} Probability 0-1
 */
export function getBorderProbability(q, r, dist, borderClusters) {
  // Reduced probabilities to ensure 100+ explorable hexes
  // Original: { 4: 0.15, 5: 0.45, 6: 0.75, 7: 0.92, 8: 1.0 }
  const baseProbabilities = { 6: 0.2, 7: 0.55, 8: 1.0 };
  let prob = baseProbabilities[dist] || 0;

  if (dist >= 5 && dist <= 7 && borderClusters.length > 0) {
    const angle = Math.atan2(r + q * 0.5, (q * Math.sqrt(3)) / 2);
    let maxAffinity = 0;
    for (const cluster of borderClusters) {
      let angleDiff = Math.abs(angle - cluster.angle);
      if (angleDiff > Math.PI) angleDiff = 2 * Math.PI - angleDiff;
      const affinity = Math.max(0, 1 - angleDiff / (Math.PI / 2));
      maxAffinity = Math.max(maxAffinity, affinity * cluster.strength);
    }
    prob = Math.min(1, prob + maxAffinity * 0.3);
  }

  return prob;
}
