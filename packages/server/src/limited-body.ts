import { Buffer } from "node:buffer";
import type { IncomingMessage } from "node:http";

/**
 * A request's body, or `undefined` once it passes `maxBytes`: a declared length over it is
 * refused before a byte is read, and the size is counted as pieces arrive. A caller that gets
 * `undefined` answers with `connection: close`, since the rest of the body is never read.
 */
export async function readLimitedBody(
  request: IncomingMessage,
  maxBytes: number,
): Promise<Uint8Array | undefined> {
  const declared = Number(request.headers["content-length"] ?? "0");
  if (Number.isFinite(declared) && declared > maxBytes) {
    return undefined;
  }
  const pieces: Buffer[] = [];
  let size = 0;
  for await (const piece of request) {
    const bytes = Buffer.isBuffer(piece) ? piece : Buffer.from(String(piece));
    size += bytes.byteLength;
    if (size > maxBytes) {
      return undefined;
    }
    pieces.push(bytes);
  }
  return Buffer.concat(pieces);
}
