import type { Bridge, DepositRef, DepositStatus } from "@binference/chain";
import { BinferenceError, type Clock, type Id, type Logger } from "@binference/core";
import type { PublishPush } from "../pushes/engine-push.js";
import { noticePush } from "../pushes/notice-push.js";
import { callVenue } from "../venues/call-venue.js";

/** What the status reads of the bridge follower work with. */
export interface StatusReadParts {
  readonly clock: Clock;
  readonly publish: PublishPush;
  /** Where a status read that fails is logged by its code; nothing is logged without it. */
  readonly log?: Logger;
}

/** One status read: the bridge's venue, the deposit and the intent it pays. */
interface StatusRead {
  readonly venue: Bridge;
  readonly deposit: DepositRef;
  readonly intent: Id<"int">;
  readonly signal: AbortSignal;
}

/** The follower's reads of where each deposit stands, which remember how each venue answered. */
export interface StatusReads {
  /**
   * Where the deposit stands by its venue's word, or `undefined` when the venue rests after a
   * throttled answer, or does not answer this time.
   */
  readonly read: (call: StatusRead) => Promise<DepositStatus | undefined>;
}

// A venue's status answers within this, or counts as not read this time.
const statusTimeoutMs = 10_000;
// A venue that throttles is left alone this long, doubling on each throttled answer up to the cap,
// as Relay's rate-limit guide asks of a client.
const firstRestMs = 30_000;
const longestRestMs = 15 * 60 * 1_000;
// A bridge whose status keeps failing is logged at most once an hour.
const logEveryMs = 60 * 60 * 1_000;

interface Rest {
  readonly untilMs: number;
  readonly waitMs: number;
}

// The last part of a venue's fault code, such as `rate_limited` of `relay.rate_limited`; a
// timeout or a throw that is not ours is `venue_down`.
function kindOf(code: string): string {
  return code.split(".").at(-1) ?? code;
}

/** What the reads remember across passes: each venue's rest, each bridge's last log, the keys told. */
interface ReadMemory {
  readonly parts: StatusReadParts;
  readonly rests: Map<string, Rest>;
  readonly logged: Map<Id<"int">, number>;
  readonly toldKey: Set<string>;
}

// A failed read: logged by its code at most once an hour per bridge; a throttled venue rests,
// doubling up to the cap; a refused key told once per venue.
function noteFailure(memory: ReadMemory, call: StatusRead, code: string): void {
  const { parts, rests, logged, toldKey } = memory;
  const atMs = parts.clock.now();
  const venue = call.venue.id;
  if (atMs >= (logged.get(call.intent) ?? -logEveryMs) + logEveryMs) {
    logged.set(call.intent, atMs);
    parts.log?.warn("bridge.status_unread", {
      intentId: call.intent,
      sourceId: venue,
      errorCode: code,
    });
  }
  const kind = kindOf(code);
  if (kind === "rate_limited") {
    const waitMs = Math.min((rests.get(venue)?.waitMs ?? firstRestMs / 2) * 2, longestRestMs);
    rests.set(venue, { untilMs: atMs + waitMs, waitMs });
  }
  if (kind === "unauthorized" && !toldKey.has(venue)) {
    toldKey.add(venue);
    parts.publish(noticePush({ key: "notice.bridgeKeyNeeded", values: { venue } }));
  }
}

/**
 * Creates the follower's status reads (decision 0320). A read that fails is logged by its code,
 * at most once an hour per bridge, never with the venue's text. A throttled answer rests the
 * venue for the rest of the pass and longer, from 30 seconds doubling to 15 minutes, and its next
 * answer ends the rest. A refused or missing key tells the owner once, by `notice.bridgeKeyNeeded`,
 * which names the venue whose key to set.
 */
export function createStatusReads(parts: StatusReadParts): StatusReads {
  const memory: ReadMemory = { parts, rests: new Map(), logged: new Map(), toldKey: new Set() };
  const { rests, logged } = memory;
  return {
    async read(call) {
      const venue = call.venue.id;
      const rest = rests.get(venue);
      if (rest !== undefined && parts.clock.now() < rest.untilMs) {
        return undefined;
      }
      let code = "venue_down";
      const timing = { clock: parts.clock, signal: call.signal, timeoutMs: statusTimeoutMs };
      const status = await callVenue(async (inner) => {
        try {
          return await call.venue.status(call.deposit, { signal: inner });
        } catch (error) {
          code = error instanceof BinferenceError ? error.code : code;
          throw error;
        }
      }, timing);
      if (status.ok) {
        rests.delete(venue);
        logged.delete(call.intent);
        return status.value;
      }
      noteFailure(memory, call, code);
      return undefined;
    },
  };
}
