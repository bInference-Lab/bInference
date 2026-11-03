import type { JsonValue } from "@binference/core";
import {
  type Address,
  encodeAbiParameters,
  type Hex,
  keccak256,
  pad,
  size,
  slice,
  toHex,
} from "viem";
import { assemble, fail, op, p } from "./crash-assembler.js";

/** Calls anvil itself, past the test's counting and kills. */
type AnvilCall = (method: string, params: readonly JsonValue[]) => Promise<JsonValue>;

/** What a scripted contract does on its caller's next call: one log, then a payment of coin. */
export interface ScriptedMove {
  /** The log's three topics, its event first. */
  readonly topics: readonly [Hex, Hex, Hex];
  /** The log's data: at most two words. */
  readonly data: Hex;
  /** The coin it pays the caller, in wei. */
  readonly payout: bigint;
}

// Each caller's script sits in the slots from the hash of its address on: the topics count, three
// topics, the words of data, two words, and the payout.
const at = { count: 0n, topics: 1n, words: 4n, data: 5n, payout: 7n };

/**
 * The runtime code of a scripted contract: it takes any call and its coin, and when its caller has
 * a script, it writes the script's log, pays the caller the script's coin and clears the script;
 * with none, it does nothing. A test writes the script before the call, as the move a venue's
 * model made.
 */
export const scriptedMoveCode: Hex = assemble([
  op.caller,
  p(1, 0n),
  op.mstore,
  p(1, 32n),
  p(1, 0n),
  op.sha3,
  op.dup1,
  op.sload,
  op.isZero,
  { to: "done" },
  op.jumpI,
  op.dup1,
  p(1, at.data),
  op.add,
  op.sload,
  p(1, 0n),
  op.mstore,
  op.dup1,
  p(1, at.data + 1n),
  op.add,
  op.sload,
  p(1, 32n),
  op.mstore,
  op.dup1,
  p(1, at.topics + 2n),
  op.add,
  op.sload,
  op.dup2,
  p(1, at.topics + 1n),
  op.add,
  op.sload,
  op.dup3,
  p(1, at.topics),
  op.add,
  op.sload,
  op.dup4,
  p(1, at.words),
  op.add,
  op.sload,
  p(1, 32n),
  op.mul,
  p(1, 0n),
  op.log3,
  p(1, 0n),
  p(1, 0n),
  p(1, 0n),
  p(1, 0n),
  op.dup5,
  p(1, at.payout),
  op.add,
  op.sload,
  op.caller,
  op.gas,
  op.call,
  op.isZero,
  { to: "fail" },
  op.jumpI,
  p(1, 0n),
  op.swap1,
  op.sstore,
  op.stop,
  // With no script, as a simulation before the test wrote it runs the call, two fresh slots are
  // written, which costs more gas than any script: the gas limit set from that run covers the
  // scripted move anvil then runs.
  { mark: "done" },
  p(1, 1n),
  p(1, 1n),
  op.sstore,
  p(1, 1n),
  p(1, 2n),
  op.sstore,
  op.stop,
  ...fail,
]);

// The first slot of the caller's script.
function scriptSlot(caller: Address): bigint {
  return BigInt(keccak256(encodeAbiParameters([{ type: "address" }], [caller])));
}

// The data's words, each 32 bytes, at most two.
function wordsOf(data: Hex): readonly Hex[] {
  const count = size(data) / 32;
  return Array.from({ length: count }, (_, index) => slice(data, index * 32, (index + 1) * 32));
}

/** Writes the move the scripted contract at `contract` makes on the caller's next call to it. */
export async function scriptMove(
  anvil: AnvilCall,
  script: { readonly contract: Address; readonly caller: Address; readonly move: ScriptedMove },
): Promise<void> {
  const base = scriptSlot(script.caller);
  const { move } = script;
  const words = wordsOf(move.data);
  const slots: readonly (readonly [bigint, bigint | Hex])[] = [
    [at.count, 3n],
    ...move.topics.map((topic, index) => [at.topics + BigInt(index), topic] as const),
    [at.words, BigInt(words.length)],
    ...words.map((word, index) => [at.data + BigInt(index), word] as const),
    [at.payout, move.payout],
  ];
  await Promise.all(
    slots.map(async ([offset, value]) =>
      anvil("anvil_setStorageAt", [
        script.contract,
        toHex(base + offset, { size: 32 }),
        typeof value === "bigint" ? pad(toHex(value), { size: 32 }) : value,
      ]),
    ),
  );
}
