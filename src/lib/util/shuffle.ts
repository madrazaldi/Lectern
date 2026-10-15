/**
 * Seeded shuffling. Audiobookshelf's `sort=random` reshuffles on every request, so paging through it
 * repeats some titles and skips others; the library shuffles the whole filtered set once instead, and a
 * seed keeps that order stable for Back navigation.
 */

/** mulberry32: a tiny, good-enough PRNG returning floats in [0, 1). */
export function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A shuffled copy (Fisher–Yates), the same for the same seed and input. */
export function shuffled<T>(items: readonly T[], seed: number): T[] {
  const out = [...items];
  const next = rng(seed);
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export function newSeed() {
  return Math.floor(Math.random() * 2 ** 31);
}
