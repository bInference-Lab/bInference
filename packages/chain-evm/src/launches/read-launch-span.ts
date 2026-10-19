import {
  type AccountRef,
  accountRefParts,
  assetRefParts,
  type FoundLaunch,
  type LaunchChange,
  type LaunchFacts,
  type LaunchLog,
  type LaunchReader,
  type ReadAnswer,
  type TxHash,
} from "@binference/chain";
import { BinferenceError } from "@binference/core";
import { type Address, type Hex, isHex, toHex } from "viem";
import { type EvmChain, evmAccountRef } from "../evm-chain.js";
import { blockHeaderSchema, type ChainLog } from "../leaders/chain-block.schema.js";
import { requestResult } from "../rpc/request-result.js";
import type { RpcFailover } from "../rpc/rpc-call.js";
import { accountAddressOn } from "../sending/account-address-on.js";
import { askLogs, type LogReader } from "../watching/ask-logs.js";
import { readAggregate } from "../watching/read-aggregate.js";

/** A launchpad the launch feed reads on a chain: its venue id, its reading and its contracts. */
export interface FeedLaunchpad {
  readonly id: string;
  readonly reader: LaunchReader;
  /** Its declared contracts on the chain, by their names in the registry. */
  readonly contracts: Readonly<Record<string, AccountRef>>;
}

/** One launch as the launch feed read it, its facts completed. */
export interface FeedLaunch extends Omit<FoundLaunch, "index" | "complete"> {
  /** The launchpad venue's id. */
  readonly launchpad: string;
  readonly block: bigint;
  readonly blockHash: Hex;
  readonly txHash: TxHash;
  /** Its create event's index among its block's logs. */
  readonly logIndex: number;
  /** Its block's time. */
  readonly launchedAtMs: number;
}

/** What one read of the launch feed found, from `from` to `to`, both included. */
export interface LaunchRead {
  readonly from: bigint;
  readonly to: bigint;
  /** The hash of block `to`, where the next read goes on from. */
  readonly toHash: Hex;
  /** In block and log order. */
  readonly launches: readonly FeedLaunch[];
  /** In block and log order. */
  readonly changes: readonly LaunchChange[];
}

/** What the launch feed reads one span with. */
export interface LaunchSpanReader {
  readonly chain: EvmChain;
  readonly rpc: RpcFailover;
  /** The failover the log query goes through (decision 0252). */
  readonly logsRpc: RpcFailover;
  readonly multicall: Address;
  readonly launchpads: readonly FeedLaunchpad[];
  readonly signal: AbortSignal;
  readonly timeoutMs?: number;
}

/** The blocks of one read: the hash of `to`, and whether `to` is the newest block. */
export interface LaunchSpan {
  readonly from: bigint;
  readonly to: bigint;
  readonly toHash: Hex;
  readonly atHead: boolean;
}

// A read completes at most this many launches; the rest keep what their logs say (decision 0256).
const maxCompletedLaunches = 50;
// What a launch keeps of what its creator wrote, so one launch never fills a write.
const maxInsiders = 100;
const maxWordLength = 200;

const decimalOf = (value: bigint): string => value.toString(10);

interface Found {
  readonly launchpad: string;
  readonly launch: FoundLaunch;
  readonly log: ChainLog;
}

// Every log of the launchpads' events in the span, from any contract, in block and log order. A
// span an endpoint refuses as too large is asked again in halves.
async function spanLogs(
  reader: LogReader,
  span: { readonly from: bigint; readonly to: bigint; readonly blockHash?: Hex },
  events: readonly string[],
): Promise<readonly ChainLog[]> {
  const logs = await askLogs(reader, { ...span, topics: [events] });
  if (logs !== "too_large") {
    return logs;
  }
  if (span.from === span.to) {
    throw new BinferenceError({
      code: "chain.rpc_error",
      message: `Every endpoint refused the launch logs of block ${String(span.from)} as too large.`,
      details: { block: decimalOf(span.from) },
    });
  }
  const middle = span.from + (span.to - span.from) / 2n;
  const halves = [
    { from: span.from, to: middle },
    { from: middle + 1n, to: span.to },
  ];
  const read = await Promise.all(halves.map(async (half) => spanLogs(reader, half, events)));
  return read.flat();
}

// The logs of each transaction, in the order the block holds them.
function byTransaction(logs: readonly ChainLog[]): readonly (readonly ChainLog[])[] {
  const transactions = new Map<string, ChainLog[]>();
  for (const log of logs) {
    const key = `${log.blockHash}|${log.transactionHash}`;
    transactions.set(key, [...(transactions.get(key) ?? []), log]);
  }
  return [...transactions.values()];
}

function launchLogOf(chain: EvmChain, log: ChainLog): LaunchLog {
  const { topics, data, logIndex: index } = log;
  return { emitter: evmAccountRef(chain, log.address), topics, data, index };
}

// Whether a launchpad's reading names only things of the chain, as a launch must.
function isOnChain(chain: EvmChain, launch: FoundLaunch): boolean {
  const accounts = [launch.creator, ...launch.insiders];
  return (
    assetRefParts(launch.token).chain === chain.ref &&
    assetRefParts(launch.quoteAsset).chain === chain.ref &&
    accounts.every((account) => accountRefParts(account).chain === chain.ref)
  );
}

// Each launchpad's launches and curve changes in one transaction's logs.
function readTransaction(
  reader: LaunchSpanReader,
  logs: readonly ChainLog[],
): { readonly found: readonly Found[]; readonly changes: readonly LaunchChange[] } {
  const { chain } = reader;
  const launchLogs = logs.map((log) => launchLogOf(chain, log));
  const read = reader.launchpads.map(({ id, reader: launchpad, contracts }) => ({
    id,
    ...launchpad.readLaunches({ chain: chain.ref, contracts, logs: launchLogs }),
  }));
  const found = read.flatMap(({ id, launches }) =>
    launches.flatMap((launch) => {
      const log = logs.find(({ logIndex }) => logIndex === launch.index);
      return log === undefined || !isOnChain(chain, launch) ? [] : [{ launchpad: id, launch, log }];
    }),
  );
  return { found, changes: read.flatMap(({ changes }) => changes) };
}

// The time of each block a launch is in; a block that moved since its logs is read again.
async function blockTimes(
  reader: LaunchSpanReader,
  found: readonly Found[],
): Promise<ReadonlyMap<bigint, number>> {
  const blocks = new Map(found.map(({ log }) => [log.blockNumber, log.blockHash]));
  const times = await Promise.all(
    [...blocks].map(async ([block, hash]) => {
      const header = await requestResult(reader.rpc, {
        method: "eth_getBlockByNumber",
        params: [toHex(block), false],
        result: blockHeaderSchema.nullable(),
        signal: reader.signal,
        ...(reader.timeoutMs === undefined ? {} : { timeoutMs: reader.timeoutMs }),
      });
      if (header?.hash !== hash) {
        throw new BinferenceError({
          code: "chain.block_missing",
          message: `Block ${String(block)} no longer holds the launch logs read; it is read again.`,
          retryable: true,
        });
      }
      return [block, header.timestampMs] as const;
    }),
  );
  return new Map(times);
}

// The facts the completions of the first launches read at one block, by launch; none for the rest.
async function completions(
  reader: LaunchSpanReader,
  span: LaunchSpan,
  found: readonly Found[],
): Promise<readonly LaunchFacts[]> {
  const completing = found.slice(0, maxCompletedLaunches).map(({ launch }) => launch.complete);
  const calls = completing.flatMap((complete) => complete?.calls ?? []);
  if (calls.length === 0) {
    return found.map(() => ({}));
  }
  const answers = await readAggregate(reader.rpc, {
    multicall: reader.multicall,
    calls: calls.map(({ target, input }) => ({
      target: accountAddressOn(reader.chain, target),
      callData: isHex(input) ? input : "0x",
    })),
    signal: reader.signal,
    ...(span.atHead ? { block: span.to, atHead: true } : {}),
    ...(reader.timeoutMs === undefined ? {} : { timeoutMs: reader.timeoutMs }),
  });
  const queue: ReadAnswer[] = [...answers];
  return found.map((_found, place) => {
    const complete = completing[place];
    return complete === undefined ? {} : complete.facts(queue.splice(0, complete.calls.length));
  });
}

function feedLaunchOf(found: Found, facts: LaunchFacts, launchedAtMs: number): FeedLaunch {
  const { complete: _complete, index, ...launch } = found.launch;
  const { symbol, name } = { ...launch, ...facts };
  return {
    ...launch,
    ...facts,
    ...(symbol === undefined ? {} : { symbol: symbol.slice(0, maxWordLength) }),
    ...(name === undefined ? {} : { name: name.slice(0, maxWordLength) }),
    graduated: launch.graduated || facts.graduated === true,
    insiders: launch.insiders.slice(0, maxInsiders),
    launchpad: found.launchpad,
    block: found.log.blockNumber,
    blockHash: found.log.blockHash,
    txHash: found.log.transactionHash,
    logIndex: index,
    launchedAtMs,
  };
}

/**
 * Reads one span of blocks for the launch feed (decision 0256): every launchpad's declared events
 * in one log query from any contract, asked again in halves when an endpoint refuses it as too
 * large; each transaction's logs read by every launchpad, which believes only its own contracts;
 * the time of each block a launch is in; and the reads that complete the first 50 launches, in
 * one Multicall3 call at the span's last block when it is the newest, else at the latest. Rejects
 * on a fault, so the caller reads the span again, and with the signal's reason once it aborts.
 */
export async function readLaunchSpan(
  reader: LaunchSpanReader,
  span: LaunchSpan,
): Promise<LaunchRead> {
  const events = [...new Set(reader.launchpads.flatMap(({ reader: pad }) => pad.launchEvents))];
  const logReader = {
    rpc: reader.logsRpc,
    signal: reader.signal,
    ...(reader.timeoutMs === undefined ? {} : { timeoutMs: reader.timeoutMs }),
  };
  const asked = span.from === span.to ? { ...span, blockHash: span.toHash } : span;
  const logs = (await spanLogs(logReader, asked, events)).filter(({ removed }) => !removed);
  const read = byTransaction(logs).map((transaction) => readTransaction(reader, transaction));
  const found = read.flatMap((transaction) => transaction.found);
  const [times, facts] = await Promise.all([
    blockTimes(reader, found),
    completions(reader, span, found),
  ]);
  const launches = found.map((item, place) =>
    feedLaunchOf(item, facts[place] ?? {}, times.get(item.log.blockNumber) ?? 0),
  );
  const changes = read.flatMap((transaction) => transaction.changes);
  return { from: span.from, to: span.to, toHash: span.toHash, launches, changes };
}
