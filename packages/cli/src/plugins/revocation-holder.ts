import { type Clock, err, ok, type Result } from "@binference/core";
import { openEnvelope } from "./listing-envelope.js";
import type { ListingKeys } from "./listing-keys.js";
import { type RevocationList, revocationListSchema } from "./plugin-listing.schema.js";

/**
 * Why a revocation list was not taken (decision 0435): it did not verify, did not read as a list,
 * was signed more than 5 minutes ahead of this clock, had expired, came before the floor, was
 * another list of the floor's sequence, or left out a listing the list taken before named.
 */
type TakeRefusal = "unverified" | "malformed" | "early" | "expired" | "older" | "forked" | "shrank";

/** The newest revocation list taken, as the plugin lock keeps it: no older list is taken after. */
export interface RevocationFloor {
  readonly sequence: number;
  /** The id of the key that signed it. */
  readonly key: string;
  /** Its payload's SHA-256, in hex. */
  readonly digest: string;
}

/** The revocation list an engine holds, and the rules each new one must pass to replace it. */
export interface RevocationHolder {
  /** Takes a list's envelope when it passes every rule, else keeps the list it holds. */
  take(envelope: string): Result<RevocationList, TakeRefusal>;
  /** The newest list taken while the clock says it is still good; none once it expired. */
  fresh(): RevocationList | undefined;
  /** The newest list taken, whether or not it expired: what it revoked stays revoked. */
  newest(): RevocationList | undefined;
  /** The floor of the newest list taken, or the one restored. */
  floor(): RevocationFloor | undefined;
  /**
   * Starts from the floor the plugin lock kept, when it is above the holder's own and its key
   * is still in force; one whose key left the set is dropped, so a key that leaked cannot set a
   * floor no later list reaches. A list held below the floor taken is dropped with it.
   */
  restore(floor: RevocationFloor | undefined): void;
}

const earlyMs = 5 * 60_000;

interface Held {
  list: RevocationList | undefined;
  floor: RevocationFloor | undefined;
}

// Where a list stands against the floor: newer, the same list read again, or refused.
function againstFloor(
  floor: RevocationFloor | undefined,
  taken: { readonly sequence: number; readonly digest: string },
): "newer" | "same" | "older" | "forked" {
  if (floor === undefined || taken.sequence > floor.sequence) {
    return "newer";
  }
  if (taken.sequence < floor.sequence) {
    return "older";
  }
  return taken.digest === floor.digest ? "same" : "forked";
}

// The refusal a verified list earns by its times and what it names, or none.
function timeRefusal(list: RevocationList, now: number): TakeRefusal | undefined {
  if (list.issuedAt > now + earlyMs) {
    return "early";
  }
  return list.expiresAt <= now ? "expired" : undefined;
}

const keepsEvery = (before: RevocationList | undefined, list: RevocationList): boolean => {
  const named = new Set(list.revoked);
  return before === undefined || before.revoked.every((listing) => named.has(listing));
};

// Why a verified list is not taken over the one held, or none when it passes every rule.
function refusalOf(
  held: Held,
  taken: { readonly list: RevocationList; readonly digest: string },
  now: number,
): TakeRefusal | undefined {
  const { list } = taken;
  const standing = againstFloor(held.floor, { sequence: list.sequence, digest: taken.digest });
  if (standing === "older" || standing === "forked") {
    return standing;
  }
  return timeRefusal(list, now) ?? (keepsEvery(held.list, list) ? undefined : "shrank");
}

/**
 * Holds the newest revocation list this engine took (decision 0435). A list is taken only when it
 * verifies under a key in force, reads as a list, was signed at most 5 minutes ahead of the clock
 * and has not expired, comes above the floor (or is the floor's own list read again), and names
 * every listing the list taken before named.
 */
export function createRevocationHolder(parts: {
  readonly keys: ListingKeys;
  readonly clock: Clock;
}): RevocationHolder {
  const held: Held = { list: undefined, floor: undefined };
  return {
    take(envelope) {
      const opened = openEnvelope(envelope, { kind: "pluginRevocations", keys: parts.keys });
      if (!opened.ok) {
        return err("unverified");
      }
      const read = revocationListSchema.safeParse(opened.value.payload);
      if (!read.success) {
        return err("malformed");
      }
      const list = read.data;
      const { key, digest } = opened.value;
      const refusal = refusalOf(held, { list, digest }, parts.clock.now());
      if (refusal !== undefined) {
        return err(refusal);
      }
      held.list = list;
      held.floor = { sequence: list.sequence, key, digest };
      return ok(list);
    },
    fresh: () => {
      const { list } = held;
      return list !== undefined && list.expiresAt > parts.clock.now() ? list : undefined;
    },
    newest: () => held.list,
    floor: () => held.floor,
    restore: (floor) => {
      const isAbove = floor !== undefined && floor.sequence > (held.floor?.sequence ?? 0);
      if (isAbove && parts.keys.keyOf(floor.key) !== undefined) {
        held.floor = floor;
        held.list =
          held.list !== undefined && held.list.sequence < floor.sequence ? undefined : held.list;
      }
    },
  };
}
