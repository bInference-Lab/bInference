import { type AccountRef, accountRefSchema, type CurveRequest } from "@binference/plugin-sdk";
import { curveTokenOn, parseEvmAddress } from "@binference/plugin-sdk/evm";
import type { Address } from "viem";
import { launchedAtCallData, numberOf, snipeTaxExemptedTopic } from "../contracts/genius-calls.js";
import { type GeniusRead, readCall, unreadable } from "../contracts/read-genius.js";
import { factoriesOf } from "../geniusfun-contracts.js";
import { findLaunch } from "../launch/find-launch.js";
import { curveKeyOf, type VenueParts } from "../venue-parts.js";
import { blockLogsSchema, type ReceiptLog } from "./block-answers.schema.js";
import { blocksOfSecond } from "./launch-blocks.js";

async function logsOf(read: GeniusRead, block: bigint): Promise<readonly ReceiptLog[]> {
  const reply = await read.rpc.request({
    method: "eth_getBlockReceipts",
    params: [`0x${block.toString(16)}`],
    result: blockLogsSchema,
    signal: read.signal,
  });
  if (reply.kind === "error") {
    throw unreadable(`the receipts of block ${String(block)} could not be read.`);
  }
  return reply.value;
}

// The accounts a curve's `SnipeTaxExempted(account)` logs name, each once, in log order.
function exemptedBy(logs: readonly ReceiptLog[], curve: Address): readonly Address[] {
  const topic = snipeTaxExemptedTopic.toLowerCase();
  const fromCurve = logs.filter(
    (log) =>
      log.topics[0]?.toLowerCase() === topic && log.address.toLowerCase() === curve.toLowerCase(),
  );
  const named = fromCurve.flatMap((log) => {
    const address = parseEvmAddress(`0x${(log.topics[1] ?? "").slice(-40)}`);
    return address.ok ? [address.value] : [];
  });
  return [...new Set(named)];
}

/**
 * The wallets a Genius.fun launch exempted from its snipe tax: its creator, its fee recipient and
 * the wallets the creator named, each once. The factory exempts them only in the launch's own
 * transaction, so they are read from the `SnipeTaxExempted` logs of the curve in the blocks of its
 * launch second (`launchedAt()`), from their receipts, since public nodes serve no log queries. A
 * token no listed stack launched, or an asset that is no ERC-20 token of a chain the venue trades
 * on, has none. What a launch exempted never changes, so each curve's answer is kept. A contract,
 * a block or a receipt that cannot be read throws.
 */
export async function readInsiders(
  request: CurveRequest,
  parts: VenueParts,
  signal: AbortSignal,
): Promise<readonly AccountRef[]> {
  signal.throwIfAborted();
  const held = curveTokenOn(request.token, parts.setups);
  if (held === undefined) {
    return [];
  }
  const { setup, token } = held;
  const read = { rpc: setup.rpc, signal };
  const finding = await findLaunch(read, factoriesOf(request.contracts), token);
  if (finding.kind !== "launched") {
    return [];
  }
  const { curve } = finding.launch;
  const key = curveKeyOf(setup.chain, curve);
  const kept = parts.insiders.get(key);
  if (kept !== undefined) {
    return kept;
  }
  const asked = { to: curve, data: launchedAtCallData, what: "the curve's launch second" };
  const blocks = await blocksOfSecond(read, await readCall(read, asked, numberOf));
  const logs = await Promise.all(blocks.map(async (block) => logsOf(read, block)));
  const insiders = exemptedBy(logs.flat(), curve).map((address) =>
    accountRefSchema.parse(`${setup.chain}:${address}`),
  );
  parts.insiders.set(key, insiders);
  return insiders;
}
