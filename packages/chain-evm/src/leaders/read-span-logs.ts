import { BinferenceError } from "@binference/core";
import { type Address, type Hex, pad, toHex } from "viem";
import { z } from "zod";
import { isQueryTooLarge } from "../rpc/node-fault.js";
import type { RpcFailover } from "../rpc/rpc-call.js";
import { type ChainLog, chainLogSchema } from "./chain-block.schema.js";
import { type SpanLogs, transferTopic, type WalletOverflow } from "./wallet-transfers.js";

/** What a span's logs are read with. */
export interface LogReader {
  readonly rpc: RpcFailover;
  /** How long one endpoint may take; the failover's own timeout when absent. */
  readonly timeoutMs?: number;
  readonly signal: AbortSignal;
}

/** Blocks to read the tracked wallets' transfers in. */
export interface LogSpan {
  readonly from: bigint;
  readonly to: bigint;
  /** The hash of the one block of a span at the head, read by hash so no node answers another. */
  readonly blockHash?: Hex;
  readonly addresses: readonly Address[];
}

/** A span's logs, and the wallets' blocks an endpoint refused even alone. */
export interface SpanRead {
  readonly logs: SpanLogs;
  readonly refused: readonly WalletOverflow[];
}

const logsSchema = z.array(chainLogSchema);

// One log query: every Transfer from the addresses, or every one to them. A filter ANDs its
// topic positions, so the two need two queries.
async function queryLogs(
  reader: LogReader,
  span: LogSpan,
  side: keyof SpanLogs,
): Promise<readonly ChainLog[] | "too_large"> {
  const accounts = span.addresses.map((address) => pad(address, { size: 32 }).toLowerCase());
  const topics = side === "sent" ? [transferTopic, accounts] : [transferTopic, null, accounts];
  const blocks =
    span.blockHash === undefined
      ? { fromBlock: toHex(span.from), toBlock: toHex(span.to) }
      : { blockHash: span.blockHash };
  const method = "eth_getLogs";
  const reply = await reader.rpc.request({
    method,
    params: [{ ...blocks, topics }],
    result: logsSchema,
    signal: reader.signal,
    ...(span.blockHash === undefined ? {} : { atHead: true }),
    ...(reader.timeoutMs === undefined ? {} : { timeoutMs: reader.timeoutMs }),
  });
  if (reply.kind === "result") {
    return reply.value;
  }
  if (isQueryTooLarge(reply)) {
    return "too_large";
  }
  throw new BinferenceError({
    code: "chain.rpc_error",
    message: `${method} failed on ${reply.endpoint}: ${reply.message}`,
    details: { method, endpoint: reply.endpoint, rpcCode: reply.code },
  });
}

function halvesOf(span: LogSpan): readonly LogSpan[] {
  const { from, to, addresses } = span;
  if (from < to) {
    const middle = from + (to - from) / 2n;
    return [
      { from, to: middle, addresses },
      { from: middle + 1n, to, addresses },
    ];
  }
  const cut = Math.ceil(addresses.length / 2);
  const head = { from, to, ...(span.blockHash === undefined ? {} : { blockHash: span.blockHash }) };
  return [
    { ...head, addresses: addresses.slice(0, cut) },
    { ...head, addresses: addresses.slice(cut) },
  ];
}

/**
 * Reads the ERC-20 transfers from and to the span's addresses, in two log queries (decision
 * 0250). A query an endpoint refuses as too large is asked again over half the blocks, down to
 * one, then for half the addresses; a single address an endpoint refuses at one block comes back
 * in `refused`, its block cut. Rejects on any other fault, and with the signal's reason once it
 * aborts.
 */
export async function readSpanLogs(reader: LogReader, span: LogSpan): Promise<SpanRead> {
  const [sent, received] = await Promise.all([
    queryLogs(reader, span, "sent"),
    queryLogs(reader, span, "received"),
  ]);
  if (sent !== "too_large" && received !== "too_large") {
    return { logs: { sent, received }, refused: [] };
  }
  const [only] = span.addresses;
  if (span.from === span.to && span.addresses.length === 1 && only !== undefined) {
    return { logs: { sent: [], received: [] }, refused: [{ account: only, block: span.from }] };
  }
  const halves = await Promise.all(halvesOf(span).map(async (half) => readSpanLogs(reader, half)));
  return {
    logs: {
      sent: halves.flatMap(({ logs }) => logs.sent),
      received: halves.flatMap(({ logs }) => logs.received),
    },
    refused: halves.flatMap(({ refused }) => refused),
  };
}
