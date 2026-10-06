import { BinferenceError } from "../errors/binference-error.js";
import type { Clock, Random } from "../ports.js";
import { type Id, isId, isIdPrefix } from "./id.js";

/** Makes new ids. */
export interface IdSource {
  /** A new id with the given prefix: the clock's milliseconds, then random bits. */
  next<P extends string>(prefix: P): Id<P>;
}

/** What an {@link IdSource} reads time and randomness from. */
export interface IdSourceOptions {
  readonly clock: Clock;
  readonly random: Random;
}

const timestampBits = 48n;

function hex(bytes: Readonly<Uint8Array>): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

// RFC 9562 layout: 48 bits of Unix milliseconds, version 7, 12 random bits, variant 10, 62 random
// bits.
function uuidV7(milliseconds: number, random: Readonly<Uint8Array>): string {
  const time = (BigInt(milliseconds) & ((1n << timestampBits) - 1n)).toString(16).padStart(12, "0");
  const bytes = Uint8Array.from(random);
  bytes[0] = ((bytes[0] ?? 0) & 0x0f) | 0x70;
  bytes[2] = ((bytes[2] ?? 0) & 0x3f) | 0x80;
  const tail = hex(bytes);
  return [
    time.slice(0, 8),
    time.slice(8, 12),
    tail.slice(0, 4),
    tail.slice(4, 8),
    tail.slice(8, 20),
  ].join("-");
}

/** Creates an {@link IdSource} that reads time and randomness through the given ports. */
export function createIdSource(options: IdSourceOptions): IdSource {
  return {
    next<P extends string>(prefix: P): Id<P> {
      if (!isIdPrefix(prefix)) {
        throw new BinferenceError({
          code: "core.bad_id_prefix",
          message: "An id prefix is two to four lowercase letters.",
          details: { prefix },
        });
      }
      const text = `${prefix}_${uuidV7(options.clock.now(), options.random.bytes(10))}`;
      if (!isId(prefix, text)) {
        throw new BinferenceError({
          code: "core.bad_random",
          message: "The Random port returned fewer bytes than asked.",
        });
      }
      return text;
    },
  };
}
