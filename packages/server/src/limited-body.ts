import { Buffer } from "node:buffer";
import type { IncomingMessage } from "node:http";
import { err, ok, type Result } from "@binference/core";

/**
 * Why a body was not read: `too_large` once it passes the limit, a declared length over it
 * refused before a byte is read; `cut` when the sender closed, or Node closed the connection at
 * its request timeout, before the body was whole.
 */
export type BodyRefusal = "too_large" | "cut";

async function readPieces(
  request: IncomingMessage,
  maxBytes: number,
): Promise<Result<Uint8Array, BodyRefusal>> {
  const pieces: Buffer[] = [];
  let size = 0;
  for await (const piece of request) {
    const bytes = Buffer.isBuffer(piece) ? piece : Buffer.from(String(piece));
    size += bytes.byteLength;
    if (size > maxBytes) {
      return err("too_large");
    }
    pieces.push(bytes);
  }
  return ok(Buffer.concat(pieces));
}

/**
 * A request's body, counted as pieces arrive, or why it was not read. It never rejects: a body
 * cut off answers `cut`, so a sender that drops its connection cannot fault the server. A caller
 * that gets `too_large` answers with `connection: close`, since the rest of the body is never
 * read; one that gets `cut` has no one to answer.
 */
export async function readLimitedBody(
  request: IncomingMessage,
  maxBytes: number,
): Promise<Result<Uint8Array, BodyRefusal>> {
  const declared = Number(request.headers["content-length"] ?? "0");
  if (Number.isFinite(declared) && declared > maxBytes) {
    return err("too_large");
  }
  try {
    return await readPieces(request, maxBytes);
  } catch {
    return err("cut");
  }
}
