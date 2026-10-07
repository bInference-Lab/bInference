import { randomBytes } from "node:crypto";
import type { Random } from "@binference/core";

/** Random bytes from the OS's secure generator, for ids, tokens and nonces. */
export function createSystemRandom(): Random {
  return { bytes: (length) => new Uint8Array(randomBytes(length)) };
}
