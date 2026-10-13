import { readFileSync, writeFileSync } from "node:fs";
import process from "node:process";
import { setTimeout as delay } from "node:timers/promises";
import { parseArgs } from "node:util";
import { parseEvmAddress } from "@binference/chain-evm";
import {
  type PairSync,
  type PoolPath,
  recordedBlocks,
  syncReserves,
  syncTopic,
  writePricePath,
} from "@binference/chain-evm/replay";
import { bsc } from "@binference/chains";
import { z } from "zod";

// Records one UTC day of prices for the replay suite (`pnpm test:replay`): the Sync events of the
// PancakeSwap v2 pairs of three registry tokens with WBNB, read from 48 Club's public BSC node,
// which serves eth_getLogs. It reads gently, one call at a time, and writes the small price path
// the replay drives today's pools along. Run it once per day recorded:
//
//   pnpm replay:record --day 2026-10-12 --out packages/chain-evm/src/replay/days/2026-10-12.json
//   pnpm format packages/chain-evm/src/replay/days/2026-10-12.json
//
// --raw <file> also keeps the decoded syncs in a private file (never commit it), and --from-raw
// <file> writes the path from such a file without reading the node again.

const node = "https://rpc.48.club";
const symbols = ["BTCB", "ETH", "Cake"];
const quoteSymbol = "WBNB";
const blocksPerCall = 1_000n;
// 48 Club allows 80 calls in 5 s and 720 a minute from one address; one call at a time, with a
// pause between, stays far under both.
const pauseMs = 300;
const callTimeoutMs = 60_000;
const flakyWaitsMs = [5_000, 15_000, 45_000];
const lowFiveSeconds = 10;
const lowMinute = 60;
const minMoveBps = 1;
const daySeconds = 86_400n;

const replySchema = z.looseObject({
  result: z.unknown().optional(),
  error: z.looseObject({ message: z.string() }).optional(),
});
const quantitySchema = z
  .string()
  .regex(/^0x[0-9a-fA-F]+$/)
  .transform(BigInt);
const blockSchema = z.looseObject({ number: quantitySchema, timestamp: quantitySchema });
const wordSchema = z.string().regex(/^0x[0-9a-fA-F]{64}$/);
const logSchema = z.looseObject({
  address: z.string(),
  blockNumber: quantitySchema,
  logIndex: quantitySchema,
  topics: z.array(z.templateLiteral(["0x", z.string()])),
  data: z.templateLiteral(["0x", z.string()]),
});
const rawSchema = z.strictObject({
  day: z.iso.date(),
  firstBlock: z.string(),
  lastBlock: z.string(),
  pools: z.array(
    z.strictObject({
      symbol: z.string(),
      token: z.string(),
      quote: z.string(),
      pair: z.string(),
      tokenDecimals: z.int(),
      quoteDecimals: z.int(),
      isToken0: z.boolean(),
      syncs: z.array(z.tuple([z.string(), z.string(), z.string(), z.string()])),
    }),
  ),
});
type Raw = z.infer<typeof rawSchema>;

// The two windows of 48 Club's limit, as its x-ratelimit-remaining header counts them down.
function remainingOf(header: string | null): readonly number[] {
  return [...(header ?? "").matchAll(/"(\d+)\//g)].map((match) => Number(match[1]));
}

async function pace(response: Response): Promise<void> {
  const [fiveSeconds = Infinity, minute = Infinity] = remainingOf(
    response.headers.get("x-ratelimit-remaining"),
  );
  if (minute < lowMinute) {
    await delay(30_000);
  } else if (fiveSeconds < lowFiveSeconds) {
    await delay(5_000);
  } else {
    await delay(pauseMs);
  }
}

let calls = 0;

async function call(method: string, params: readonly unknown[], attempt = 0): Promise<unknown> {
  calls += 1;
  const response = await fetch(node, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: calls, method, params }),
    signal: AbortSignal.timeout(callTimeoutMs),
  });
  const isFlaky = response.status === 403 || response.status === 429 || response.status >= 500;
  const waitMs = flakyWaitsMs[attempt];
  if (isFlaky && waitMs !== undefined) {
    console.error(`${method}: HTTP ${String(response.status)}, again in ${String(waitMs)} ms.`);
    await delay(waitMs);
    return call(method, params, attempt + 1);
  }
  if (!response.ok) {
    throw new Error(`${method}: HTTP ${String(response.status)} from ${new URL(node).host}.`);
  }
  const reply = replySchema.parse(await response.json());
  await pace(response);
  if (reply.error !== undefined) {
    throw new Error(`${method} refused: ${reply.error.message}`);
  }
  return reply.result;
}

const hex = (value: bigint): string => `0x${value.toString(16)}`;

async function timestampOf(block: bigint): Promise<bigint> {
  return blockSchema.parse(await call("eth_getBlockByNumber", [hex(block), false])).timestamp;
}

// The first block at or after `seconds`, between `low` (before it) and `high` (at or after it).
async function firstBlockAt(seconds: bigint, low: bigint, high: bigint): Promise<bigint> {
  if (high - low <= 1n) {
    return high;
  }
  const middle = (low + high) / 2n;
  return (await timestampOf(middle)) >= seconds
    ? firstBlockAt(seconds, low, middle)
    : firstBlockAt(seconds, middle, high);
}

async function ethCall(to: string, data: string): Promise<string> {
  return wordSchema.parse(await call("eth_call", [{ to, data }, "latest"]));
}

function registryAddress(symbol: string): string {
  const token = bsc.tokens.find((item) => item.symbol === symbol);
  if (token === undefined) {
    throw new Error(`The BSC registry lists no ${symbol}.`);
  }
  return token.address;
}

function factoryAddress(): string {
  const factory = bsc.contracts.find(
    (item) => item.venue === "pancakeswap" && item.name === "v2-factory",
  );
  if (factory === undefined) {
    throw new Error("The BSC registry lists no PancakeSwap v2 factory.");
  }
  return factory.address;
}

const word = (address: string): string => address.slice(2).toLowerCase().padStart(64, "0");
const addressOfWord = (answer: string): string => `0x${answer.slice(26)}`;

async function pairOf(symbol: string): Promise<Raw["pools"][number]> {
  const token = registryAddress(symbol);
  const quote = registryAddress(quoteSymbol);
  // getPair(address,address), token0(), decimals()
  const pair = addressOfWord(
    await ethCall(factoryAddress(), `0xe6a43905${word(token)}${word(quote)}`),
  );
  const token0 = addressOfWord(await ethCall(pair, "0x0dfe1681"));
  const tokenDecimals = Number(BigInt(await ethCall(token, "0x313ce567")));
  const quoteDecimals = Number(BigInt(await ethCall(quote, "0x313ce567")));
  const isToken0 = token0 === token.toLowerCase();
  return { symbol, token, quote, pair, tokenDecimals, quoteDecimals, isToken0, syncs: [] };
}

function keepSyncs(raw: Raw, logs: readonly z.infer<typeof logSchema>[]): void {
  const byPair = new Map(raw.pools.map((pool) => [pool.pair.toLowerCase(), pool]));
  for (const log of logs) {
    const { reserve0, reserve1 } = syncReserves(log);
    byPair
      .get(log.address.toLowerCase())
      ?.syncs.push([
        log.blockNumber.toString(),
        log.logIndex.toString(),
        reserve0.toString(),
        reserve1.toString(),
      ]);
  }
}

// Reads the day's Sync logs from block `from` on, one call of 1,000 blocks at a time.
async function readSyncs(raw: Raw, from: bigint): Promise<void> {
  const last = BigInt(raw.lastBlock);
  if (from > last) {
    return;
  }
  const to = from + blocksPerCall - 1n < last ? from + blocksPerCall - 1n : last;
  const filter = {
    fromBlock: hex(from),
    toBlock: hex(to),
    address: raw.pools.map(({ pair }) => pair),
    topics: [syncTopic],
  };
  keepSyncs(raw, z.array(logSchema).parse(await call("eth_getLogs", [filter])));
  if ((to - BigInt(raw.firstBlock) + 1n) % (blocksPerCall * 20n) === 0n || to === last) {
    const synced = raw.pools.map(({ symbol, syncs }) => `${symbol} ${String(syncs.length)}`);
    console.log(`Read to block ${to.toString()} of ${last.toString()}: ${synced.join(", ")}.`);
  }
  await readSyncs(raw, to + 1n);
}

async function record(day: string): Promise<Raw> {
  const start = BigInt(Date.parse(`${day}T00:00:00Z`) / 1_000);
  const head = quantitySchema.parse(await call("eth_blockNumber", []));
  const headSeconds = await timestampOf(head);
  if (headSeconds < start + daySeconds) {
    throw new Error(`${day} has not ended on the chain yet.`);
  }
  // Blocks come at least every 3 s, so the day starts within this many blocks of the head.
  const span = ((headSeconds - start) * 10n) / 3n;
  const low = head > span ? head - span : 0n;
  const firstBlock = await firstBlockAt(start, low, head);
  const lastBlock = (await firstBlockAt(start + daySeconds, firstBlock, head)) - 1n;
  console.log(`${day} is blocks ${firstBlock.toString()} to ${lastBlock.toString()}.`);
  // One pair after the other, so the node never sees a burst.
  const pools = await symbols.reduce<Promise<Raw["pools"]>>(
    async (read, symbol) => [...(await read), await pairOf(symbol)],
    Promise.resolve([]),
  );
  const raw: Raw = {
    day,
    firstBlock: firstBlock.toString(),
    lastBlock: lastBlock.toString(),
    pools,
  };
  await readSyncs(raw, firstBlock);
  return raw;
}

function checksummed(address: string): PoolPath["token"] {
  const parsed = parseEvmAddress(address);
  if (!parsed.ok) {
    throw new Error(`${address} is not an EVM address.`);
  }
  return parsed.value;
}

function pathOf(raw: Raw): string {
  const firstBlock = BigInt(raw.firstBlock);
  const pools = raw.pools.map((pool): PoolPath => {
    const syncs = pool.syncs.map(([block, logIndex, reserve0, reserve1]): PairSync => ({
      block: BigInt(block),
      logIndex: BigInt(logIndex),
      reserve0: BigInt(reserve0),
      reserve1: BigInt(reserve1),
    }));
    const shape = { ...pool, firstBlock, minMoveBps };
    const { symbol, tokenDecimals, quoteDecimals } = pool;
    const blocks = recordedBlocks(syncs, shape);
    const addresses = {
      token: checksummed(pool.token),
      quote: checksummed(pool.quote),
      pair: checksummed(pool.pair),
    };
    console.log(`${symbol}: ${String(syncs.length)} syncs, ${String(blocks.length)} blocks kept.`);
    return { ...addresses, symbol, tokenDecimals, quoteDecimals, blocks };
  });
  return writePricePath({
    day: raw.day,
    firstBlock,
    lastBlock: BigInt(raw.lastBlock),
    minMoveBps,
    pools,
  });
}

const { values } = parseArgs({
  options: {
    day: { type: "string" },
    out: { type: "string" },
    raw: { type: "string" },
    "from-raw": { type: "string" },
  },
});
const fromRaw = values["from-raw"];
if (values.out === undefined || (values.day === undefined && fromRaw === undefined)) {
  console.error("Usage: pnpm replay:record --day YYYY-MM-DD --out <file> [--raw <file>]");
  process.exit(2);
}
const raw =
  fromRaw === undefined
    ? await record(values.day ?? "")
    : rawSchema.parse(JSON.parse(readFileSync(fromRaw, "utf8")));
if (values.raw !== undefined) {
  writeFileSync(values.raw, JSON.stringify(raw));
}
writeFileSync(values.out, pathOf(raw));
console.log(`Wrote ${values.out} after ${String(calls)} calls to ${new URL(node).host}.`);
