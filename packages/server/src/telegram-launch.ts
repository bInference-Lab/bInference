import { Buffer } from "node:buffer";
import { createHmac, timingSafeEqual } from "node:crypto";
import { err, ok, type Result, type Secret } from "@binference/core";
import { decodeTelegramUserId } from "./telegram-user.schema.js";

/** A Mini App launch whose `initData` Telegram signed with the owner's bot token. */
export interface TelegramLaunch {
  /** The launch's `hash` field, 64 hex digits: the key of the replay check. */
  readonly hash: string;
  /** The numeric id of the Telegram user who opened the Mini App. */
  readonly userId: number;
  readonly authDateMs: number;
}

/**
 * Why a launch fails its check: `malformed` for data Telegram never sends (a missing or repeated
 * field, a bad `auth_date` or `user`), `forged` for a signature the bot token did not make, `stale`
 * for an `auth_date` too long before now or too far after it.
 */
export type TelegramLaunchRefusal = "malformed" | "forged" | "stale";

/** One launch to check. */
export interface TelegramLaunchCheck {
  /** The `initData` query string, as the Mini App reads it from Telegram. */
  readonly initData: string;
  readonly botToken: Secret;
  readonly nowMs: number;
  /** How long before now `auth_date` may lie. */
  readonly maxAgeMs: number;
  /** How far after now `auth_date` may lie, for a clock a little behind Telegram's. */
  readonly maxAheadMs: number;
}

const hashPattern = /^[0-9a-f]{64}$/;
const decimalPattern = /^[1-9][0-9]{0,15}$/;

// The fields of the query string, or `undefined` when a key appears twice: Telegram sends each
// field once, so a repeat is data someone else built.
function fieldsOf(initData: string): ReadonlyMap<string, string> | undefined {
  const fields = new Map<string, string>();
  for (const [key, value] of new URLSearchParams(initData)) {
    if (fields.has(key)) {
      return undefined;
    }
    fields.set(key, value);
  }
  return fields;
}

// Telegram's data-check string: every field but `hash`, as `key=value` with the value decoded,
// sorted by key and joined with line feeds.
function dataCheckString(fields: ReadonlyMap<string, string>): string {
  return [...fields]
    .filter(([key]) => key !== "hash")
    .toSorted(([a], [b]) => (a < b ? -1 : 1))
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");
}

/**
 * The signature Telegram puts in a launch's `hash`: HMAC-SHA-256 over the data-check string, keyed
 * with HMAC-SHA-256 of the bot token under the key `WebAppData`, in lowercase hex.
 */
export function telegramLaunchHash(fields: ReadonlyMap<string, string>, botToken: Secret): string {
  const key = createHmac("sha256", "WebAppData").update(botToken.reveal()).digest();
  return createHmac("sha256", key).update(dataCheckString(fields)).digest("hex");
}

// The launch's `hash` when it is the signature the bot token makes over the other fields.
function signedHash(fields: ReadonlyMap<string, string>, botToken: Secret): string | undefined {
  const given = fields.get("hash");
  if (given === undefined || !hashPattern.test(given)) {
    return undefined;
  }
  const expected = Buffer.from(telegramLaunchHash(fields, botToken), "hex");
  return timingSafeEqual(expected, Buffer.from(given, "hex")) ? given : undefined;
}

/**
 * Checks a Telegram Mini App launch by Telegram's documented rule: the `hash` field must equal the
 * HMAC of the other fields (compared in constant time), `auth_date` must lie at most `maxAgeMs`
 * before now and at most `maxAheadMs` after it, so a clock a little behind Telegram's still signs
 * in, and `user` must carry a numeric id. Whose id it is, and whether the launch was used before, the caller decides.
 */
export function checkTelegramLaunch(
  check: TelegramLaunchCheck,
): Result<TelegramLaunch, TelegramLaunchRefusal> {
  const fields = fieldsOf(check.initData);
  if (fields === undefined) {
    return err("malformed");
  }
  const hash = signedHash(fields, check.botToken);
  if (hash === undefined) {
    return err("forged");
  }
  const authDate = fields.get("auth_date");
  const user = fields.get("user");
  const userId = user === undefined ? undefined : decodeTelegramUserId(user);
  if (authDate === undefined || !decimalPattern.test(authDate) || userId === undefined) {
    return err("malformed");
  }
  const authDateMs = Number(authDate) * 1_000;
  const ageMs = check.nowMs - authDateMs;
  if (ageMs > check.maxAgeMs || -ageMs > check.maxAheadMs) {
    return err("stale");
  }
  return ok({ hash, userId, authDateMs });
}
