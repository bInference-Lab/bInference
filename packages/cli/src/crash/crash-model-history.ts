import type { JsonValue } from "@binference/core";
import type { Hex } from "viem";
import { z } from "zod";

/** Calls anvil itself, past the test's counting and kills. */
type AnvilCall = (method: string, params: readonly JsonValue[]) => Promise<JsonValue>;

/**
 * A stand-in model's earlier states: the state before each move it made, kept with the move's
 * transaction, so a read at an earlier block, such as the block before a move landed, reads the
 * state the chain held then.
 */
export interface ModelHistory<M> {
  /** Keeps the state the model held before the transaction's move. */
  readonly moved: (hash: Hex, before: M) => void;
  /** The state at the block a call names: before the first move that had not landed by it. */
  readonly at: (block: JsonValue, current: M) => Promise<M>;
}

/** The wall clock in whole seconds, which anvil's new blocks take on the bare chain. */
export function wallSeconds(): bigint {
  return BigInt(Math.floor(Date.now() / 1_000));
}

const receiptSchema = z.object({ blockNumber: z.string() }).nullable();
const blockNumberSchema = z.string().regex(/^0x[0-9a-f]+$/iu);

/** A history of no move yet, which reads each move's landing block from anvil. */
export function createModelHistory<M>(anvil: AnvilCall): ModelHistory<M> {
  const moves: { readonly hash: Hex; readonly before: M }[] = [];
  const landings = new Map<Hex, bigint>();
  const landedAt = async (hash: Hex): Promise<bigint | undefined> => {
    const known = landings.get(hash);
    if (known !== undefined) {
      return known;
    }
    const receipt = receiptSchema.parse(await anvil("eth_getTransactionReceipt", [hash]));
    if (receipt !== null) {
      landings.set(hash, BigInt(receipt.blockNumber));
    }
    return landings.get(hash);
  };
  const stateAt = async (number: bigint, current: M, index: number): Promise<M> => {
    const move = moves[index];
    if (move === undefined) {
      return current;
    }
    const landed = await landedAt(move.hash);
    return landed === undefined || landed > number
      ? move.before
      : stateAt(number, current, index + 1);
  };
  return {
    moved: (hash, before) => {
      moves.push({ hash, before });
    },
    at: async (block, current) => {
      const number = blockNumberSchema.safeParse(block);
      return number.success ? stateAt(BigInt(number.data), current, 0) : current;
    },
  };
}
