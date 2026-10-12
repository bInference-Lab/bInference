import type { ReadAnswer } from "@binference/chain";
import { BinferenceError } from "@binference/core";
import type { AggregateCall } from "./read-aggregate.js";

// Multicall3 hands every call all the gas left and takes no limit per call, so a batch is bounded
// as a whole: 1,000,000 a call, at most the 50,000,000 that geth and its forks allow a call by
// default (decision 0194).
const gasPerCall = 1_000_000n;
const maxBatchGas = 50_000_000n;

/** The gas a batch of this many calls may burn. */
export function batchGasOf(calls: number): bigint {
  const gas = BigInt(calls + 1) * gasPerCall;
  return gas < maxBatchGas ? gas : maxBatchGas;
}

// Faults a node answers about the batch itself, which a call in it may have caused.
const batchFaults: ReadonlySet<string> = new Set(["chain.rpc_error", "chain.multicall_mismatch"]);

/** Groups of calls read apart: each answered group with its answers, and those refused. */
export interface Isolated<G> {
  readonly answered: readonly { readonly group: G; readonly answers: readonly ReadAnswer[] }[];
  readonly refused: readonly { readonly group: G; readonly code: string }[];
}

/**
 * Reads the calls of every group in one batch with `ask`. When the node refuses the batch as a
 * whole, it reads each half apart, in the same way, down to the single groups it refuses, which
 * are left out with the fault's code: one call that burns its gas blinds only its own group
 * (decision 0194). Any other fault rejects, as `ask` does.
 */
export async function readIsolated<G extends { readonly calls: readonly AggregateCall[] }>(
  ask: (calls: readonly AggregateCall[]) => Promise<readonly ReadAnswer[]>,
  groups: readonly G[],
): Promise<Isolated<G>> {
  try {
    const answers = await ask(groups.flatMap(({ calls }) => calls));
    let offset = 0;
    const answered = groups.map((group) => {
      const own = answers.slice(offset, offset + group.calls.length);
      offset += group.calls.length;
      return { group, answers: own };
    });
    return { answered, refused: [] };
  } catch (error) {
    if (!(error instanceof BinferenceError) || !batchFaults.has(error.code)) {
      throw error;
    }
    const [only] = groups;
    if (groups.length === 1 && only !== undefined) {
      return { answered: [], refused: [{ group: only, code: error.code }] };
    }
    const middle = Math.ceil(groups.length / 2);
    const halves = await Promise.all([
      readIsolated(ask, groups.slice(0, middle)),
      readIsolated(ask, groups.slice(middle)),
    ]);
    return {
      answered: halves.flatMap(({ answered }) => answered),
      refused: halves.flatMap(({ refused }) => refused),
    };
  }
}
