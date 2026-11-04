import { createHash } from "node:crypto";
import { readFilePieces } from "@binference/platform";

/** The SHA-256 of a whole file in hex, read in pieces, so a large file never sits in memory. */
export async function fileSha256(file: string, signal: AbortSignal): Promise<string> {
  const hash = createHash("sha256");
  for await (const piece of readFilePieces(file, { signal })) {
    hash.update(piece);
  }
  return hash.digest("hex");
}
