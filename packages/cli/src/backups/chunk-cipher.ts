import { createCipheriv, createDecipheriv } from "node:crypto";
import { BinferenceError } from "@binference/core";

/** The plaintext bytes of every chunk but the last (keys spec, section 7.2): 64 KiB. */
export const chunkBytes = 65_536;
/** The bytes of AES-256-GCM's tag after each chunk. */
export const tagBytes = 16;
/** The bytes of a backup's nonce prefix. */
export const noncePrefixBytes = 8;
/** The bytes of a backup's data key. */
export const dataKeyBytes = 32;

const maxChunks = 2 ** 32;

/** What binds every chunk of one backup: its nonce prefix and the SHA-256 of its header line. */
export interface ChunkFrame {
  readonly noncePrefix: Uint8Array;
  readonly headerDigest: Uint8Array;
}

/** Where a chunk sits: its number from 0, and whether it is the last. */
export interface ChunkPlace {
  readonly index: number;
  readonly isFinal: boolean;
}

function indexBytes(index: number): Buffer {
  if (!Number.isInteger(index) || index < 0 || index >= maxChunks) {
    throw new BinferenceError({
      code: "backup.too_many_chunks",
      message: `A backup holds at most ${String(maxChunks)} chunks; chunk ${String(index)} is past that.`,
    });
  }
  const bytes = Buffer.alloc(4);
  bytes.writeUInt32BE(index, 0);
  return bytes;
}

/** A chunk's nonce: the backup's 8-byte prefix, then the chunk's number in 4 bytes, big-endian. */
export function chunkNonce(noncePrefix: Uint8Array, index: number): Buffer {
  return Buffer.concat([noncePrefix, indexBytes(index)]);
}

/**
 * A chunk's associated data: SHA-256 of the header line, the chunk's number in 4 bytes,
 * big-endian, and 1 for the last chunk or 0 for any other, so a chunk opens only in its own
 * backup, at its own place, and a backup cut after a chunk that was not the last never opens.
 */
export function chunkAad(headerDigest: Uint8Array, place: ChunkPlace): Buffer {
  return Buffer.concat([headerDigest, indexBytes(place.index), Buffer.of(place.isFinal ? 1 : 0)]);
}

/** Encrypts one chunk with AES-256-GCM: its ciphertext, then its 16-byte tag. */
export function sealChunk(
  dataKey: Uint8Array,
  frame: ChunkFrame,
  chunk: { readonly place: ChunkPlace; readonly plaintext: Uint8Array },
): Buffer {
  const cipher = createCipheriv(
    "aes-256-gcm",
    dataKey,
    chunkNonce(frame.noncePrefix, chunk.place.index),
    {
      authTagLength: tagBytes,
    },
  );
  cipher.setAAD(chunkAad(frame.headerDigest, chunk.place));
  return Buffer.concat([cipher.update(chunk.plaintext), cipher.final(), cipher.getAuthTag()]);
}

/**
 * Decrypts one sealed chunk; `undefined` when its tag does not match: another key, another
 * backup's header, another place, or a changed byte. OpenSSL compares the tag in constant time.
 */
export function openChunk(
  dataKey: Uint8Array,
  frame: ChunkFrame,
  chunk: { readonly place: ChunkPlace; readonly sealed: Uint8Array },
): Buffer | undefined {
  const { sealed, place } = chunk;
  if (sealed.length < tagBytes) {
    return undefined;
  }
  const decipher = createDecipheriv(
    "aes-256-gcm",
    dataKey,
    chunkNonce(frame.noncePrefix, place.index),
    { authTagLength: tagBytes },
  );
  decipher.setAAD(chunkAad(frame.headerDigest, place));
  decipher.setAuthTag(sealed.subarray(sealed.length - tagBytes));
  const opened = decipher.update(sealed.subarray(0, sealed.length - tagBytes));
  try {
    return Buffer.concat([opened, decipher.final()]);
  } catch {
    opened.fill(0);
    return undefined;
  }
}
