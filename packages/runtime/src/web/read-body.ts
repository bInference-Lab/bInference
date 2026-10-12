/** The first bytes of a body, and whether more followed them. */
export interface BodyStart {
  readonly bytes: Uint8Array;
  /** The body went on past the cap; the rest was never read. */
  readonly cut: boolean;
}

function joined(pieces: readonly Uint8Array[], size: number): Uint8Array {
  const bytes = new Uint8Array(size);
  let at = 0;
  for (const piece of pieces) {
    bytes.set(piece, at);
    at += piece.byteLength;
  }
  return bytes;
}

/**
 * Reads at most `maxBytes` of a body and stops there: a larger body is cut and the connection
 * under it closed, so a page never fills memory past the cap.
 */
export async function readBodyStart(
  body: AsyncIterable<Uint8Array>,
  maxBytes: number,
): Promise<BodyStart> {
  const pieces: Uint8Array[] = [];
  let size = 0;
  for await (const piece of body) {
    const room = maxBytes - size;
    if (piece.byteLength > room) {
      pieces.push(piece.subarray(0, room));
      return { bytes: joined(pieces, maxBytes), cut: true };
    }
    pieces.push(piece);
    size += piece.byteLength;
  }
  return { bytes: joined(pieces, size), cut: false };
}

/** Closes a body the caller will not read, so its connection is not left open. */
export async function discardBody(body: AsyncIterable<Uint8Array>): Promise<void> {
  try {
    await body[Symbol.asyncIterator]().return?.();
  } catch {
    // A body that fails as it closes holds nothing the caller wants.
  }
}
