/**
 * Regroups bytes that arrive in pieces of any size into chunks of exactly `size` bytes, the last
 * one shorter when the bytes run out; no bytes give no chunk. The caller may keep each chunk.
 */
export async function* rechunk(
  pieces: AsyncIterable<Uint8Array>,
  size: number,
): AsyncGenerator<Uint8Array, void, undefined> {
  let chunk = new Uint8Array(size);
  let filled = 0;
  for await (const piece of pieces) {
    let taken = 0;
    while (taken < piece.length) {
      const step = Math.min(size - filled, piece.length - taken);
      chunk.set(piece.subarray(taken, taken + step), filled);
      filled += step;
      taken += step;
      if (filled === size) {
        yield chunk;
        chunk = new Uint8Array(size);
        filled = 0;
      }
    }
  }
  if (filled > 0) {
    yield chunk.subarray(0, filled);
  }
}
