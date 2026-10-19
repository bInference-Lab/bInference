import type { HttpRequest, HttpResponse } from "@binference/core";
import { type Address, type Hex, keccak256, stringToHex } from "viem";
import type { JsonValue } from "../rpc/json-value.schema.js";
import {
  type FakeBlock,
  type FakeChainState,
  type FakeRead,
  type FakeTx,
  fakeLeaderAnswers,
  type MinedTx,
} from "./fake-leader-answers.js";
import { type FakeRpcAnswer, fakeRpcNode } from "./fake-rpc-http.js";

export type { FakeTx } from "./fake-leader-answers.js";

/** A fake chain for the log watchers' tests, with no network. */
export interface FakeLeaderChain {
  readonly endpoint: (request: HttpRequest) => HttpResponse;
  /** Mines a block of these transactions on the head and answers its number. */
  mine(txs?: readonly FakeTx[]): bigint;
  /** Drops every block from `block` on: the next ones mined there get new hashes. */
  reorg(block: bigint): void;
  head(): bigint;
  hashOf(block: bigint): Hex;
  /** How many requests of a method it answered. */
  calls(method: string): number;
  /** Fails every request with HTTP 503 from now on, until {@link FakeLeaderChain.comeBack}. */
  goDown(): void;
  /** Answers requests again. */
  comeBack(): void;
  /**
   * Answers the next request of `method` whose first param is `first`, when given, with `answer`,
   * as a lagging or failing node would.
   */
  answerOnce(method: string, answer: FakeRpcAnswer, first?: JsonValue): void;
  /** State before this block is pruned: balances and calls there are "missing trie node". */
  pruneBefore(block: bigint): void;
}

/** What a fake chain starts with. */
export interface FakeLeaderChainOptions {
  /** Its first block, which holds no transaction. */
  readonly start: bigint;
  readonly multicall: Address;
  /** Token holdings before the first block. */
  readonly holdings?: readonly {
    readonly account: Address;
    readonly token: Address;
    readonly value: bigint;
  }[];
  /** An answer with more logs than this is refused, as providers refuse one. */
  readonly maxLogs?: number;
  /** Answers the read calls of a Multicall3 batch other than an ERC-20 `balanceOf`. */
  readonly reads?: FakeRead;
}

// More logs than any test's block holds.
const unlimitedLogs = 1_000_000;

function stateOf(options: FakeLeaderChainOptions): FakeChainState {
  return {
    blocks: [],
    start: options.start,
    multicall: options.multicall,
    holdings: options.holdings ?? [],
    maxLogs: options.maxLogs ?? unlimitedLogs,
    ...(options.reads === undefined ? {} : { reads: options.reads }),
    generation: 0,
    prunedBelow: 0n,
  };
}

function mineOn(state: FakeChainState, txs: readonly FakeTx[]): bigint {
  const hashFor = (number: bigint, salt: string): Hex =>
    keccak256(stringToHex(`${number.toString()}:${String(state.generation)}:${salt}`));
  const parent = state.blocks.at(-1);
  const number = parent === undefined ? state.start : parent.number + 1n;
  const mined = txs.map((tx, index): MinedTx => ({
    hash: hashFor(number, `tx${String(index)}`),
    from: tx.from,
    ...(tx.to === undefined ? {} : { to: tx.to }),
    value: tx.value ?? 0n,
    transfers: tx.transfers ?? [],
    pays: tx.pays ?? [],
    fee: tx.fee ?? 0n,
    logs: tx.logs ?? [],
  }));
  const parentHash = parent?.hash ?? hashFor(number - 1n, "parent");
  const block: FakeBlock = { number, hash: hashFor(number, "block"), parentHash, txs: mined };
  state.blocks.push(block);
  return number;
}

/**
 * Creates a {@link FakeLeaderChain}: it answers the head, blocks with and without their
 * transactions, the last final block (two below the head), transfer logs by range or by block
 * hash with topic filters, native balances, receipts' fees, and Multicall3 batches of ERC-20
 * `balanceOf` at a block, each from the blocks it mined.
 */
export function createFakeLeaderChain(options: FakeLeaderChainOptions): FakeLeaderChain {
  const state = stateOf(options);
  const counts = new Map<string, number>();
  const flags = { isDown: false };
  const once = new Map<string, { readonly answer: FakeRpcAnswer; readonly first?: JsonValue }>();
  mineOn(state, []);
  const answers = fakeLeaderAnswers(state);
  const node = fakeRpcNode(({ method, params }) => {
    counts.set(method, (counts.get(method) ?? 0) + 1);
    const given = once.get(method);
    if (given !== undefined && (!("first" in given) || given.first === params[0])) {
      once.delete(method);
      return given.answer;
    }
    const answer = answers[method];
    return answer === undefined
      ? { error: { code: -32_601, message: "the method does not exist" } }
      : answer(params);
  });
  return {
    endpoint: (request) => (flags.isDown ? { status: 503, headers: {}, body: "" } : node(request)),
    mine: (txs = []) => mineOn(state, txs),
    reorg: (block) => {
      state.generation += 1;
      state.blocks.splice(state.blocks.findIndex((each) => each.number >= block));
    },
    head: () => state.blocks.at(-1)?.number ?? options.start,
    hashOf: (block) => state.blocks.find((each) => each.number === block)?.hash ?? "0x",
    calls: (method) => counts.get(method) ?? 0,
    goDown: () => {
      flags.isDown = true;
    },
    comeBack: () => {
      flags.isDown = false;
    },
    answerOnce: (method, answer, first) => {
      once.set(method, first === undefined ? { answer } : { answer, first });
    },
    pruneBefore: (block) => {
      state.prunedBelow = block;
    },
  };
}
