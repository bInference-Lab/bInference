import type { AccountRef } from "@binference/chain";
import { looseningWaitMs } from "./send-level-change.js";

/** A new rescue address the owner asked for, and when it takes the place of the one now. */
export interface PendingRescue {
  readonly address: AccountRef;
  /** Epoch milliseconds from which a rescue pays it: 24 hours after it was asked. */
  readonly atMs: number;
}

/**
 * The install's rescue address as it was written, and a new one that waits for its time. A
 * pending address whose time has come is the rescue address, though the row still names it as
 * pending; read the address in effect through `rescueAt`.
 */
export interface RescueState {
  readonly rescueAddress?: AccountRef;
  readonly pendingRescue?: PendingRescue;
}

/**
 * The rescue address in effect at `nowMs`, and nothing else of the state it is given: a pending
 * address whose time has come replaces it, and one still waiting stays pending. Every reader of a
 * stored state goes through this.
 */
export function rescueAt(state: RescueState, nowMs: number): RescueState {
  const { rescueAddress, pendingRescue } = state;
  if (pendingRescue !== undefined && pendingRescue.atMs <= nowMs) {
    return { rescueAddress: pendingRescue.address };
  }
  return {
    ...(rescueAddress === undefined ? {} : { rescueAddress }),
    ...(pendingRescue === undefined ? {} : { pendingRescue }),
  };
}

/**
 * Moves the rescue address toward `address`, judged against the address in effect at `nowMs`
 * (decision 0044). Any new address waits 24 hours, a first one too, so a hijacked surface cannot
 * redirect a rescue before the owner sees the announcement. Asking again for the address that
 * already waits keeps its time; asking for the address in effect drops the one that waits.
 */
export function changeRescue(state: RescueState, address: AccountRef, nowMs: number): RescueState {
  const { rescueAddress, pendingRescue } = rescueAt(state, nowMs);
  const kept = rescueAddress === undefined ? {} : { rescueAddress };
  if (address === rescueAddress) {
    return kept;
  }
  return {
    ...kept,
    pendingRescue:
      pendingRescue?.address === address
        ? pendingRescue
        : { address, atMs: nowMs + looseningWaitMs },
  };
}

/** Drops a new rescue address that still waits at `nowMs`; the address in effect stays. */
export function cancelRescue(state: RescueState, nowMs: number): RescueState {
  const { rescueAddress } = rescueAt(state, nowMs);
  return rescueAddress === undefined ? {} : { rescueAddress };
}
