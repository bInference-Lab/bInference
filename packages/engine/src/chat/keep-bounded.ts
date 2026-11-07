/**
 * Puts an entry's value under its key as the newest entry, then lets the oldest entries go until at most
 * `most` remain: the bound of the engine's in-memory maps of images and files.
 */
export function keepBounded<T>(
  map: Map<string, T>,
  entry: readonly [string, T],
  most: number,
): void {
  const [key, value] = entry;
  map.delete(key);
  map.set(key, value);
  // A Map keeps the order its keys came in: the first is the oldest.
  for (const oldest of [...map.keys()].slice(0, Math.max(0, map.size - most))) {
    map.delete(oldest);
  }
}
