/**
 * Seeded Random Number Generator
 *
 * Provides deterministic pseudo-random number generation for realm generation.
 * Uses a simple LCG (Linear Congruential Generator) algorithm.
 */
export class SeededRNG {
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
