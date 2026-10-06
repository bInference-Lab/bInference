import type { Random } from "../ports.js";

/**
 * Creates a {@link Random} for tests that gives the same bytes for the same seed (mulberry32).
 * Never use it where randomness protects anything.
 */
export function createSeededRandom(seed: number): Random {
  let state = seed >>> 0;
  const nextWord = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let word = Math.imul(state ^ (state >>> 15), state | 1);
    word ^= word + Math.imul(word ^ (word >>> 7), word | 61);
    return (word ^ (word >>> 14)) >>> 0;
  };
  return {
    bytes: (length: number): Uint8Array => Uint8Array.from({ length }, () => nextWord() & 0xff),
  };
}
