import { type FileHandle, open } from "node:fs/promises";
import { BinferenceError } from "@binference/core";

/** How {@link readFilePieces} reads: the size of each piece and the deadline. */
export interface ReadPiecesOptions {
  /** The bytes of each piece; the last may be shorter. 64 KiB when left out. */
  readonly pieceBytes?: number;
  readonly signal: AbortSignal;
}

const defaultPieceBytes = 65_536;

// Runs one file call; a failure becomes `platform.file_read_failed`, naming the file.
async function reading<Output>(path: string, call: () => Promise<Output>): Promise<Output> {
  try {
    return await call();
  } catch (error) {
    throw new BinferenceError({
      code: "platform.file_read_failed",
      message: `Could not read ${path}; check that it is a file you can read.`,
      cause: error,
      details: { path },
    });
  }
}

async function readPiece(
  handle: FileHandle,
  options: { readonly path: string; readonly pieceBytes: number },
): Promise<Uint8Array | undefined> {
  const piece = new Uint8Array(options.pieceBytes);
  const { bytesRead } = await reading(options.path, async () =>
    handle.read(piece, 0, options.pieceBytes, null),
  );
  if (bytesRead === 0) {
    return undefined;
  }
  return bytesRead === options.pieceBytes ? piece : piece.subarray(0, bytesRead);
}

/**
 * Reads a file of any size from the start, a piece at a time, so it never sits in memory whole.
 * Each piece is a new buffer the caller may keep. Throws `platform.file_read_failed` when the file
 * cannot be opened or read; the file closes when the reading ends, early or not.
 */
export async function* readFilePieces(
  path: string,
  options: ReadPiecesOptions,
): AsyncGenerator<Uint8Array, void, undefined> {
  const { signal } = options;
  const pieceBytes = options.pieceBytes ?? defaultPieceBytes;
  signal.throwIfAborted();
  const handle = await reading(path, async () => open(path, "r"));
  try {
    for (;;) {
      signal.throwIfAborted();
      // oxlint-disable-next-line eslint/no-await-in-loop -- each piece follows the one before
      const piece = await readPiece(handle, { path, pieceBytes });
      if (piece === undefined) {
        return;
      }
      yield piece;
    }
  } finally {
    await handle.close();
  }
}
