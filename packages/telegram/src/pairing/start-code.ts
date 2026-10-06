import {
  BinferenceError,
  type Clock,
  createSecret,
  type Random,
  type Secret,
} from "@binference/core";
import { type AccessStore, type Sha256Hex, sha256Hex } from "@binference/engine";

/** How long a start code works when the caller sets no time: 15 minutes. */
export const startCodeLifetimeMs: number = 15 * 60 * 1000;

const codeBytes = 16;
const botUsername = /^[A-Za-z][A-Za-z0-9_]{3,31}$/;
// Telegram passes a deep link's start parameter as "/start <parameter>": 1 to 64 of A-Z, a-z,
// 0-9, _ and -. A bot name after the command is allowed, as in a group.
const startCommand = /^\/start(?:@[A-Za-z0-9_]{1,64})?\s+([A-Za-z0-9_-]{1,64})\s*$/;

/** What {@link issueStartCode} needs. */
export interface StartCodeOptions {
  /** Keeps the code's hash until it is used. */
  readonly access: AccessStore;
  readonly clock: Clock;
  readonly random: Random;
  /** The bot's username, from `getMe`, without the `@`. */
  readonly botUsername: string;
  /** How long the code works; {@link startCodeLifetimeMs} when absent. */
  readonly lifetimeMs?: number;
}

/** A start code ready to show the owner once. */
export interface StartCode {
  /** `https://t.me/<bot>?start=<code>`; whoever opens it first becomes the owner. Never log it. */
  readonly link: Secret;
  readonly expiresAtMs: number;
}

/**
 * The hash a start code is stored under. The hash names its purpose, so a console pairing code
 * never pairs a Telegram owner, and a start code never pairs a console device.
 */
export function startCodeHash(code: string): Sha256Hex {
  return sha256Hex(`telegram-start:${code}`);
}

/** The start parameter of a `/start <code>` message, if the text is one. */
export function startCodeIn(text: string): string | undefined {
  return startCommand.exec(text)?.[1];
}

/**
 * Makes a single-use start code from 16 random bytes, stores only its hash with its expiry, and
 * returns the deep link that pairs the owner. Throws `telegram.bad_username` for a malformed bot
 * username.
 */
export async function issueStartCode(
  options: StartCodeOptions,
  call: { readonly signal: AbortSignal },
): Promise<StartCode> {
  if (!botUsername.test(options.botUsername)) {
    throw new BinferenceError({
      code: "telegram.bad_username",
      message: "A bot username is 4 to 32 letters, digits or underscores, starting with a letter.",
    });
  }
  const code = Buffer.from(options.random.bytes(codeBytes)).toString("base64url");
  const expiresAtMs = options.clock.now() + (options.lifetimeMs ?? startCodeLifetimeMs);
  const added = await options.access.addPairCode(
    { codeHash: startCodeHash(code), expiresAtMs },
    call,
  );
  if (!added.ok) {
    throw new BinferenceError({
      code: "telegram.start_code_taken",
      message: "A new start code collided with a stored one; ask for another.",
    });
  }
  return {
    link: createSecret(`https://t.me/${options.botUsername}?start=${code}`),
    expiresAtMs,
  };
}
