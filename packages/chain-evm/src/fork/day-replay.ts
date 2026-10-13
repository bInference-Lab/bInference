import { BinferenceError, type Clock } from "@binference/core";
import { type Address, encodeFunctionData, erc20Abi, type Hex, parseAbi, toHex } from "viem";
import { z } from "zod";
import {
  pairAmountOut,
  type PairReserves,
  type PairSwap,
  swapToPrice,
} from "../replay/pair-swap.js";
import type { PoolPath, PricePath } from "../replay/price-path.js";
import type { ReplayStep } from "../replay/replay-steps.js";
import { hexSchema, quantitySchema } from "../rpc/evm-wire.schema.js";
import { findBalanceSlot } from "../simulation/balance-slot.js";
import { simulationReplySchema } from "../simulation/simulation-reply.schema.js";
import { isToken0 } from "../watching/pool-state.js";
import { holdBlockHistory } from "./block-history.js";
import type { Fork } from "./open-fork.js";

const pairAbi = parseAbi([
  "function getReserves() view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)",
  "function swap(uint256 amount0Out, uint256 amount1Out, address to, bytes data)",
]);

/** A recorded pool as today's fork holds it. */
export interface ReplayPool {
  readonly path: PoolPath;
  /** Whether the token is the pair's `token0`. */
  readonly isToken0: boolean;
  /** Its reserves when the replay started: the price the recorded day is scaled to. */
  readonly start: PairReserves;
}

/** A pool's reserves after a replayed block. */
export interface ReplayedPrice extends PairReserves {
  readonly pool: number;
}

/** One block the replay mined. */
export interface ReplayedBlock {
  /** The fork's block number. */
  readonly number: bigint;
  /** The recorded block it replays, as an offset in its day. */
  readonly offset: bigint;
  /** When the replay mined it, by its clock. */
  readonly minedAtMs: number;
  /** Every pool's reserves after it. */
  readonly prices: readonly ReplayedPrice[];
}

/** How a replay runs its blocks. */
export interface ReplayRun {
  /** The time between two blocks, as the chain makes them; 0 mines each as soon as it is ready. */
  readonly paceMs: number;
  /** Called with each block once it is mined. */
  readonly onBlock?: (block: ReplayedBlock) => void;
  readonly signal: AbortSignal;
}

/** A recorded day replayed on the fork, block by block. */
export interface DayReplay {
  readonly pools: readonly ReplayPool[];
  readonly steps: readonly ReplayStep[];
  /** Mines every step's block in order, and answers them. */
  run(options: ReplayRun): Promise<readonly ReplayedBlock[]>;
}

/** What a replay drives and how. */
export interface DayReplayOptions {
  readonly fork: Fork;
  readonly path: PricePath;
  readonly steps: readonly ReplayStep[];
  readonly clock: Clock;
  readonly signal: AbortSignal;
}

// A swap's two calls take under 120,000 gas; a fixed limit keeps anvil's estimate, which runs at
// the fork block's second, out of it.
const gasLimit = 300_000n;
// The test account holds this many times every pair's reserves of each side, more than any day
// moves through them.
const fundedReserves = 8n;
const okStatus = 1n;
// Blocks a test may mine around the replay's own, such as the blocks that fill its orders first.
const spareBlocks = 64;

const receiptSchema = z.looseObject({ status: quantitySchema, blockNumber: quantitySchema });

async function reservesOf(fork: Fork, pool: Omit<ReplayPool, "start">, block?: bigint) {
  const [reserve0, reserve1] = await fork.client.readContract({
    address: pool.path.pair,
    abi: pairAbi,
    functionName: "getReserves",
    ...(block === undefined ? {} : { blockNumber: block }),
  });
  return pool.isToken0
    ? { reserveToken: reserve0, reserveQuote: reserve1 }
    : { reserveToken: reserve1, reserveQuote: reserve0 };
}

// Sets the test account's balance of a token in the token's own storage: the account is funded
// without a trade, so no pool moves before the replay does.
async function fund(
  fork: Fork,
  funding: { readonly token: Address; readonly amount: bigint },
  signal: AbortSignal,
): Promise<void> {
  const { token, amount } = funding;
  const slot = await findBalanceSlot(fork.rpc, { token, holder: fork.account, signal });
  if (slot === undefined) {
    throw new BinferenceError({
      code: "fork.no_balance_slot",
      message: `The replay cannot fund the test account with ${token}.`,
    });
  }
  await fork.call("anvil_setStorageAt", [token, slot, toHex(amount, { size: 32 })]);
}

// Eight times every pair's reserves of each side: a token's own, and its quote's summed over the
// pairs that share it.
function fundings(pools: readonly ReplayPool[]): readonly { token: Address; amount: bigint }[] {
  const amounts = new Map<Address, bigint>();
  const add = (token: Address, amount: bigint): void => {
    amounts.set(token, (amounts.get(token) ?? 0n) + amount * fundedReserves);
  };
  for (const { path, start } of pools) {
    add(path.token, start.reserveToken);
    add(path.quote, start.reserveQuote);
  }
  return [...amounts].map(([token, amount]) => ({ token, amount }));
}

// A swap's two calls: the amount in sent to the pair, then the pair's own `swap`, which pays the
// amount out to the test account.
function swapCalls(fork: Fork, pool: ReplayPool, swap: PairSwap) {
  const { pair, token, quote } = pool.path;
  const transfer = encodeFunctionData({
    abi: erc20Abi,
    functionName: "transfer",
    args: [pair, swap.amountIn],
  });
  const outIsToken0 = (swap.side === "buy") === pool.isToken0;
  const outs = outIsToken0 ? ([swap.amountOut, 0n] as const) : ([0n, swap.amountOut] as const);
  const call = encodeFunctionData({
    abi: pairAbi,
    functionName: "swap",
    args: [...outs, fork.account, "0x"],
  });
  return [
    { to: swap.side === "buy" ? quote : token, data: transfer },
    { to: pair, data: call },
  ] as const;
}

// A small buy and a small sale on each pool, simulated: the fork reads every storage slot a
// replayed swap touches from its upstream now, while the node still holds the fork block's state,
// which public nodes drop within about a minute.
async function warm(fork: Fork, pools: readonly ReplayPool[]): Promise<void> {
  const calls = pools.flatMap((pool) => {
    const { reserveToken, reserveQuote } = pool.start;
    const quoteIn = reserveQuote / 10_000n;
    const tokenIn = reserveToken / 10_000n;
    const buy = {
      side: "buy",
      amountIn: quoteIn,
      amountOut: pairAmountOut(quoteIn, reserveQuote, reserveToken),
    } as const;
    const sell = {
      side: "sell",
      amountIn: tokenIn,
      amountOut: pairAmountOut(tokenIn, reserveToken, reserveQuote),
    } as const;
    return [...swapCalls(fork, pool, buy), ...swapCalls(fork, pool, sell)];
  });
  const reply = await fork.call("eth_simulateV1", [
    {
      blockStateCalls: [{ calls: calls.map(({ to, data }) => ({ from: fork.account, to, data })) }],
      validation: false,
    },
    "latest",
  ]);
  const [block] = simulationReplySchema.parse(reply);
  if (block === undefined || block.calls.some(({ status }) => status !== okStatus)) {
    throw new BinferenceError({
      code: "fork.replay_warm_failed",
      message: "A small swap on a recorded pool failed on the fork before the replay.",
    });
  }
}

async function send(fork: Fork, to: Address, data: Hex): Promise<Hex> {
  const sent = await fork.call("eth_sendTransaction", [
    { from: fork.account, to, data, gas: toHex(gasLimit) },
  ]);
  return hexSchema.parse(sent);
}

// Sends a swap's two calls, which wait in the fork's pool for the block.
async function sendSwap(fork: Fork, pool: ReplayPool, swap: PairSwap): Promise<readonly Hex[]> {
  const [transfer, call] = swapCalls(fork, pool, swap);
  return [await send(fork, transfer.to, transfer.data), await send(fork, call.to, call.data)];
}

// The pool's price at its recorded share of its start: (q0/t0) * scale, quote per token.
function targetOf(
  pool: ReplayPool,
  scale: { readonly numerator: bigint; readonly denominator: bigint },
) {
  return {
    numerator: pool.start.reserveQuote * scale.numerator,
    denominator: pool.start.reserveToken * scale.denominator,
  };
}

// The block every one of a step's calls was mined in; a call that failed stops the replay.
async function minedBlock(fork: Fork, hashes: readonly Hex[]): Promise<bigint> {
  const receipts = await Promise.all(
    hashes.map(async (hash) =>
      receiptSchema.parse(await fork.call("eth_getTransactionReceipt", [hash])),
    ),
  );
  const blocks = new Set(receipts.map(({ blockNumber }) => blockNumber));
  const [block] = blocks;
  if (
    block === undefined ||
    blocks.size > 1 ||
    receipts.some(({ status }) => status !== okStatus)
  ) {
    throw new BinferenceError({
      code: "fork.replay_step_failed",
      message: "A replayed block's swaps did not all succeed in one block.",
    });
  }
  return block;
}

/** What one step of a run works with: its options, its pools and when it is due. */
interface StepParts {
  readonly options: DayReplayOptions;
  readonly pools: readonly ReplayPool[];
  readonly run: ReplayRun;
  /** When the block is due: a pace after the block before was mined. */
  readonly dueMs: number;
}

// Sends the swaps of a step's moves, one after the other: each reads its pool as it stands.
async function sendMoves(parts: StepParts, step: ReplayStep): Promise<readonly Hex[]> {
  const { fork } = parts.options;
  return step.moves.reduce<Promise<readonly Hex[]>>(async (sent, move) => {
    const hashes = await sent;
    const pool = parts.pools[move.pool];
    if (pool === undefined) {
      return hashes;
    }
    const swap = swapToPrice(await reservesOf(fork, pool), targetOf(pool, move.scale));
    return swap === undefined ? hashes : [...hashes, ...(await sendSwap(fork, pool, swap))];
  }, Promise.resolve([]));
}

// Sends a step's swaps, mines them when the block is due and reads every pool after it.
async function mineStep(parts: StepParts, step: ReplayStep): Promise<ReplayedBlock> {
  const { fork, clock } = parts.options;
  const hashes = await sendMoves(parts, step);
  await clock.sleep(Math.max(0, parts.dueMs - clock.now()), parts.run.signal);
  await fork.call("evm_mine", []);
  const minedAtMs = clock.now();
  const number =
    hashes.length === 0 ? await fork.client.getBlockNumber() : await minedBlock(fork, hashes);
  const prices = await Promise.all(
    parts.pools.map(async (pool, at): Promise<ReplayedPrice> => {
      const { reserveToken, reserveQuote } = await reservesOf(fork, pool, number);
      return { pool: at, reserveToken, reserveQuote };
    }),
  );
  return { number, offset: step.offset, minedAtMs, prices };
}

/**
 * The first block a replay mined after `atMs`, by its clock, or the number of the block it would
 * have mined next: the block something sent at `atMs`, such as an order's fill, lands in.
 */
export function blockAfter(blocks: readonly ReplayedBlock[], atMs: number): bigint {
  const next = blocks.find(({ minedAtMs }) => minedAtMs > atMs);
  return next?.number ?? (blocks.at(-1)?.number ?? 0n) + 1n;
}

/**
 * Prepares a recorded day's replay on the fork, as it stands now. It reads each recorded pair's
 * reserves, the prices the day is scaled to; funds the test account with eight times every pair's
 * reserves of each side, in the tokens' own storage; simulates a small swap each way on each pool,
 * so the fork holds every slot a swap touches before the node drops it; and sets the block history
 * slots of the replay's blocks and 64 more (`holdBlockHistory`). Each step of `run` then sends the
 * swaps that move its pools to their recorded share of those start prices, from the test account
 * straight to the pairs, and mines them in one block `paceMs` after the block before was mined; a
 * swap that fails stops it. A replay from the same fork state mines the same blocks with the same
 * prices.
 */
export async function prepareDayReplay(options: DayReplayOptions): Promise<DayReplay> {
  const { fork, path, steps, signal } = options;
  const pools = await Promise.all(
    path.pools.map(async (poolPath): Promise<ReplayPool> => {
      const isTokenFirst = isToken0(poolPath.token, poolPath.quote);
      const start = await reservesOf(fork, { path: poolPath, isToken0: isTokenFirst });
      return { path: poolPath, isToken0: isTokenFirst, start };
    }),
  );
  await Promise.all(fundings(pools).map(async (funding) => fund(fork, funding, signal)));
  await warm(fork, pools);
  await holdBlockHistory(fork, steps.length + spareBlocks);
  return {
    pools,
    steps,
    async run(run) {
      const first = options.clock.now();
      return steps.reduce<Promise<readonly ReplayedBlock[]>>(async (mined, step) => {
        const blocks = await mined;
        const dueMs = (blocks.at(-1)?.minedAtMs ?? first) + run.paceMs;
        const block = await mineStep({ options, pools, run, dueMs }, step);
        run.onBlock?.(block);
        return [...blocks, block];
      }, Promise.resolve([]));
    },
  };
}
