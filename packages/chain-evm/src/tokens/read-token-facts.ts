import type { ReadAnswer } from "@binference/chain";
import {
  type Address,
  decodeFunctionResult,
  encodeFunctionData,
  erc20Abi,
  type Hex,
  hexToString,
  size,
  trim,
} from "viem";
import { hexSchema } from "../rpc/evm-wire.schema.js";
import type { RpcFailover } from "../rpc/rpc-call.js";
import { readAggregate } from "../watching/read-aggregate.js";
import { batchGasOf, readIsolated } from "../watching/read-isolated.js";
import { decimalsOf } from "./read-token-decimals.js";

/**
 * What an ERC-20 contract answers about itself. Its symbol and name are whatever its deployer
 * chose, so a reader shows them as outside text.
 */
export interface TokenFactsAnswer {
  readonly symbol: string;
  readonly name: string;
  readonly decimals: number;
}

type TextField = "symbol" | "name";

const calls = {
  symbol: encodeFunctionData({ abi: erc20Abi, functionName: "symbol" }),
  name: encodeFunctionData({ abi: erc20Abi, functionName: "name" }),
  decimals: encodeFunctionData({ abi: erc20Abi, functionName: "decimals" }),
};
// A card shows at most 16 characters of a symbol and 40 of a name (spec 4, section 1); what is
// kept leaves room for the cut mark and stays small in the store.
const keptLength: Readonly<Record<TextField, number>> = { symbol: 64, name: 128 };
const wordBytes = 32;

// Some early tokens answer their symbol and name as one `bytes32`, padded with zero bytes.
function bytes32Text(data: Hex): string | undefined {
  if (size(data) !== wordBytes) {
    return undefined;
  }
  try {
    return hexToString(trim(data, { dir: "right" }));
  } catch {
    return undefined;
  }
}

function abiText(field: TextField, data: Hex): string | undefined {
  try {
    return decodeFunctionResult({ abi: erc20Abi, functionName: field, data });
  } catch {
    return undefined;
  }
}

// The text an answer holds, as an ABI string or a `bytes32`, with its zero bytes dropped and cut
// to what is kept, in code points; none for an empty one or any other answer.
function textOf(field: TextField, answer: ReadAnswer): string | undefined {
  const parsed = hexSchema.safeParse(answer);
  if (!parsed.success) {
    return undefined;
  }
  const text = (abiText(field, parsed.data) ?? bytes32Text(parsed.data))?.replaceAll("\0", "");
  const kept = Array.from(text ?? "")
    .slice(0, keptLength[field])
    .join("");
  return kept.trim() === "" ? undefined : kept;
}

// A token's facts from its three answers: none without a symbol or decimals; its symbol stands
// for a name it does not answer.
function factsOf(answers: readonly ReadAnswer[]): TokenFactsAnswer | undefined {
  const [symbolAnswer, nameAnswer, decimalsAnswer] = answers;
  const symbol = textOf("symbol", symbolAnswer);
  const decimals = decimalsOf(decimalsAnswer);
  if (symbol === undefined || decimals === undefined) {
    return undefined;
  }
  return { symbol, name: textOf("name", nameAnswer) ?? symbol, decimals };
}

/**
 * The symbol, name and decimals of each ERC-20 token, all read in one Multicall3 call at the
 * latest block, bounded in gas. A symbol or name may be an ABI string or a `bytes32`. A token that
 * answers no symbol or no decimals, or fails the whole batch, as one that burns its gas does, is
 * left out: a batch the node refuses is read again in halves (decision 0194). Rejects when no
 * endpoint answers, and with the signal's reason once it aborts.
 */
export async function readTokenFacts(
  rpc: RpcFailover,
  request: {
    readonly multicall: Address;
    readonly tokens: readonly Address[];
    readonly signal: AbortSignal;
  },
): Promise<ReadonlyMap<Address, TokenFactsAnswer>> {
  request.signal.throwIfAborted();
  if (request.tokens.length === 0) {
    return new Map();
  }
  const groups = request.tokens.map((target) => ({
    token: target,
    calls: [calls.symbol, calls.name, calls.decimals].map((callData) => ({ target, callData })),
  }));
  const { multicall, signal } = request;
  const isolated = await readIsolated(
    async (batch) =>
      readAggregate(rpc, { multicall, calls: batch, signal, gas: batchGasOf(batch.length) }),
    groups,
  );
  return new Map(
    isolated.answered.flatMap(({ group, answers }) => {
      const facts = factsOf(answers);
      return facts === undefined ? [] : [[group.token, facts] as const];
    }),
  );
}
