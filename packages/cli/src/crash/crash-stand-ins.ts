import type { JsonValue } from "@binference/core";
import type { Address, Hex, TransactionSerialized } from "viem";

/** A stand-in's answer to a view: its data, or a revert. */
export type ViewAnswer = { readonly data: Hex } | "revert";

/** One `eth_call` a stand-in may answer: the contract called, the call's data and its block. */
export interface ViewCall {
  readonly to: Address;
  readonly data: Hex;
  /** The block the call names: `latest`, or a number in hex. */
  readonly block: JsonValue;
}

/**
 * A contract the crash chain answers beside anvil, for a venue whose views a bare chain cannot
 * hold: anvil runs the code the test installed at its address, and the stand-in answers its views
 * from a model of the venue's state and readies that code for each move before anvil gets it.
 */
export interface CrashStandIn {
  /** The view's answer at the call's block; `undefined` for a call to a contract it is not. */
  readonly view: (call: ViewCall) => Promise<ViewAnswer | undefined>;
  /**
   * Runs before a relay passes the signed bytes on to anvil, once per transaction however often
   * they are sent, so the stand-in's code makes the move its model made.
   */
  readonly beforeSend: (raw: TransactionSerialized) => Promise<void>;
}

/** The stand-ins a crash chain serves, and the transactions they readied. */
export interface StandIns {
  readonly add: (standIn: CrashStandIn) => void;
  /** The first stand-in's answer to the view; `undefined` when none answers it. */
  readonly view: (call: ViewCall) => Promise<ViewAnswer | undefined>;
  readonly beforeSend: (raw: TransactionSerialized, hash: Hex) => Promise<void>;
}

/** No stand-in yet; each test file adds those its runs need. */
export function createStandIns(): StandIns {
  const served: CrashStandIn[] = [];
  const readied = new Set<Hex>();
  const viewOf = async (
    call: ViewCall,
    left: readonly CrashStandIn[],
  ): Promise<ViewAnswer | undefined> => {
    const [first, ...rest] = left;
    if (first === undefined) {
      return undefined;
    }
    return (await first.view(call)) ?? viewOf(call, rest);
  };
  return {
    add: (standIn) => {
      served.push(standIn);
    },
    view: async (call) => viewOf(call, served),
    beforeSend: async (raw, hash) => {
      if (readied.has(hash)) {
        return;
      }
      readied.add(hash);
      await Promise.all(served.map(async (standIn) => standIn.beforeSend(raw)));
    },
  };
}
