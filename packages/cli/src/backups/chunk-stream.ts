import { BinferenceError } from "@binference/core";
import {
  type ChunkFrame,
  type ChunkPlace,
  chunkBytes,
  openChunk,
  sealChunk,
  tagBytes,
} from "./chunk-cipher.js";
import { rechunk } from "./rechunk.js";

/**
 * Encrypts a backup's body: the bytes regrouped into 64 KiB chunks, each sealed at its place,
 * the last one marked final. No bytes at all still give one final chunk, so every body holds one.
 */
export async function* sealBody(
  plaintext: AsyncIterable<Uint8Array>,
  dataKey: Uint8Array,
  frame: ChunkFrame,
): AsyncGenerator<Uint8Array, void, undefined> {
  let index = 0;
  let held: Uint8Array | undefined;
  for await (const chunk of rechunk(plaintext, chunkBytes)) {
    if (held !== undefined) {
      yield sealChunk(dataKey, frame, { place: { index, isFinal: false }, plaintext: held });
      index += 1;
    }
    held = chunk;
  }
  const last = held ?? new Uint8Array(0);
  yield sealChunk(dataKey, frame, { place: { index, isFinal: true }, plaintext: last });
}

function damaged(index: number): BinferenceError {
  return new BinferenceError({
    code: "backup.damaged",
    message: `Chunk ${String(index)} of the backup does not open: the file is cut, changed or out of order.`,
    details: { chunk: index },
  });
}

/**
 * Decrypts a backup's body chunk by chunk. A chunk is the last only when nothing follows it, so a
 * chunk that does not open, one missing, moved or added, and a body cut at any byte all throw
 * `backup.damaged`. Each chunk comes out once its tag matched, before the next is read: what came
 * out counts as checked only once the whole body opened.
 */
export async function* openBody(
  sealed: AsyncIterable<Uint8Array>,
  dataKey: Uint8Array,
  frame: ChunkFrame,
): AsyncGenerator<Uint8Array, void, undefined> {
  let index = 0;
  let held: Uint8Array | undefined;
  const open = (chunk: Uint8Array, place: ChunkPlace): Buffer => {
    const opened = openChunk(dataKey, frame, { place, sealed: chunk });
    if (opened === undefined) {
      throw damaged(place.index);
    }
    return opened;
  };
  for await (const chunk of rechunk(sealed, chunkBytes + tagBytes)) {
    if (held !== undefined) {
      yield open(held, { index, isFinal: false });
      index += 1;
    }
    held = chunk;
  }
  if (held === undefined) {
    throw damaged(0);
  }
  yield open(held, { index, isFinal: true });
}
