import { Buffer } from "node:buffer";
import { BinferenceError, type Clock, type Random } from "@binference/core";
import type { AccessStore } from "../ports.js";
import { type Sha256Hex, sha256Hex } from "../records/sha256-hex.js";

/** How long a console pairing code works: 10 minutes (protocol spec, section 4.2). */
export const consolePairLifetimeMs: number = 10 * 60 * 1000;

const codeBytes = 16;

/**
 * The hash a console pairing code is stored under. The hash names its purpose, so a console code
 * never pairs a Telegram owner, and a Telegram start code never pairs a console device.
 */
export function consolePairCodeHash(code: string): Sha256Hex {
  return sha256Hex(`console-pair:${code}`);
}

/** What {@link issueConsolePairCode} stores the code through. */
export interface ConsolePairCodeOptions {
  readonly access: AccessStore;
  readonly clock: Clock;
  readonly random: Random;
}

/** A pairing code to show the owner once: never log it. */
export interface ConsolePairCode {
  readonly code: string;
  readonly expiresAtMs: number;
}

/**
 * Makes a single-use console pairing code from 16 random bytes in base64url and stores only its
 * hash, valid {@link consolePairLifetimeMs}. Throws `engine.pair_code_taken` on the rare collision
 * with a stored code.
 */
export async function issueConsolePairCode(
  options: ConsolePairCodeOptions,
  call: { readonly signal: AbortSignal },
): Promise<ConsolePairCode> {
  const code = Buffer.from(options.random.bytes(codeBytes)).toString("base64url");
  const expiresAtMs = options.clock.now() + consolePairLifetimeMs;
  const added = await options.access.addPairCode(
    { codeHash: consolePairCodeHash(code), expiresAtMs },
    call,
  );
  if (!added.ok) {
    throw new BinferenceError({
      code: "engine.pair_code_taken",
      message: "A new pairing code collided with a stored one; ask for another.",
    });
  }
  return { code, expiresAtMs };
}
