import type { PriceMiss, ReadAnswer } from "@binference/chain";
import { err, ok, type Ratio, type Result } from "@binference/core";
import {
  type Address,
  encodeFunctionData,
  getAddress,
  type Hex,
  hexToBigInt,
  numberToHex,
  parseAbi,
  size,
  slice,
} from "viem";
import { hexSchema } from "../rpc/evm-wire.schema.js";

/**
 * The reads of the two pool kinds every Uniswap-style DEX shares: a v2 pair's reserves and a v3
 * pool's current price. PancakeSwap's v3 pools answer `slot0` with a wider fee field than
 * Uniswap's, in as many words, so only the first word, the price, is read.
 */
const poolAbi = parseAbi([
  "function getPair(address tokenA, address tokenB) view returns (address pair)",
  "function getPool(address tokenA, address tokenB, uint24 fee) view returns (address pool)",
  "function getReserves() view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)",
  "function slot0() view returns (uint160 sqrtPriceX96, int24 tick, uint16 observationIndex, uint16 observationCardinality, uint16 observationCardinalityNext, uint32 feeProtocol, bool unlocked)",
  "function liquidity() view returns (uint128 liquidity)",
]);

/** The kinds of pool the chain family prices a token from. */
export type PoolKind = "v2" | "v3";

/** The calldata of a v2 factory's `getPair(token, quote)`. */
export function pairCallData(token: Address, quote: Address): Hex {
  return encodeFunctionData({ abi: poolAbi, functionName: "getPair", args: [token, quote] });
}

/** The calldata of a v3 factory's `getPool(token, quote, fee)`. */
export function poolCallData(token: Address, quote: Address, fee: number): Hex {
  return encodeFunctionData({ abi: poolAbi, functionName: "getPool", args: [token, quote, fee] });
}

/** The calldata of `getReserves()`. */
export const reservesCall: Hex = encodeFunctionData({ abi: poolAbi, functionName: "getReserves" });

/** The calldata of `slot0()`. */
export const slot0Call: Hex = encodeFunctionData({ abi: poolAbi, functionName: "slot0" });

/** The calldata of `liquidity()`. */
export const liquidityCall: Hex = encodeFunctionData({ abi: poolAbi, functionName: "liquidity" });

/** The calls that read a pool's price and depth: a v2 pair's reserves; a v3 pool's `slot0` and
 * `liquidity()`. */
export function poolReadCalls(kind: PoolKind): readonly Hex[] {
  return kind === "v2" ? [reservesCall] : [slot0Call, liquidityCall];
}

const wordBytes = 32;
const reservesWords = 3;
const slot0Words = 7;
const maxUint112 = 2n ** 112n - 1n;
const maxUint128 = 2n ** 128n - 1n;
const maxUint160 = 2n ** 160n - 1n;
const q96 = 2n ** 96n;
const q192 = 2n ** 192n;

/** The `index`th 32-byte word of an answer, as an unsigned number. */
function wordOf(answer: Hex, index: number): bigint {
  return hexToBigInt(slice(answer, index * wordBytes, (index + 1) * wordBytes));
}

function wordsIn(answer: ReadAnswer, words: number): Hex | undefined {
  const parsed = hexSchema.safeParse(answer);
  return parsed.success && size(parsed.data) === words * wordBytes ? parsed.data : undefined;
}

/** The address a one-word answer holds, such as a factory's pool; none for any other answer. */
export function addressAnswer(answer: ReadAnswer): Address | undefined {
  const data = wordsIn(answer, 1);
  const word = data === undefined ? undefined : wordOf(data, 0);
  return word === undefined || word > maxUint160
    ? undefined
    : getAddress(numberToHex(word, { size: 20 }));
}

/** The number a one-word answer holds, such as a balance; undefined for any other answer. */
export function numberAnswer(answer: ReadAnswer): bigint | undefined {
  const data = wordsIn(answer, 1);
  return data === undefined ? undefined : wordOf(data, 0);
}

/**
 * Whether the token is its pool's `token0`: every Uniswap-style pool orders its two tokens by
 * address, the lower first.
 */
export function isToken0(token: Address, quote: Address): boolean {
  return token.toLowerCase() < quote.toLowerCase();
}

/** A pool and how it pairs the token: which kind it is and whether the token is its `token0`. */
export interface PoolPlace {
  readonly kind: PoolKind;
  readonly isToken0: boolean;
  /**
   * The least depth, in base units of the quote token, the pool must keep to price the token; a
   * pool under it asks for another (decision 0194). None when absent.
   */
  readonly minDepth?: bigint;
}

/**
 * A pool's price of the token, in base units of the quote for one base unit of it, and its depth:
 * the quote it can trade, in base units. A v2 pair's depth is its quote reserve; a v3 pool's, its
 * liquidity in range as a quote amount at its current price. Neither is a balance, which a deposit
 * or liquidity out of range would inflate.
 */
export interface PoolState {
  readonly price: Ratio;
  readonly depth: bigint;
}

function reservesState(answer: Hex, place: PoolPlace): Result<PoolState, PriceMiss> {
  const reserve0 = wordOf(answer, 0);
  const reserve1 = wordOf(answer, 1);
  if (reserve0 > maxUint112 || reserve1 > maxUint112) {
    return err("unpriced");
  }
  // A pair with an empty side no longer prices the token: another pool must.
  if (reserve0 === 0n || reserve1 === 0n) {
    return err("replan");
  }
  return place.isToken0
    ? ok({ price: { numerator: reserve1, denominator: reserve0 }, depth: reserve1 })
    : ok({ price: { numerator: reserve0, denominator: reserve1 }, depth: reserve0 });
}

// The square of the price in Q64.96 is token1 per token0 in Q192. Liquidity L in range at that
// price trades as L·√P of token1 and L/√P of token0.
function slot0State(
  answer: Hex,
  liquidity: bigint,
  place: PoolPlace,
): Result<PoolState, PriceMiss> {
  const sqrtPriceX96 = wordOf(answer, 0);
  if (sqrtPriceX96 === 0n || sqrtPriceX96 > maxUint160 || liquidity > maxUint128) {
    return err("unpriced");
  }
  // A pool with no liquidity in range quotes a price nobody can trade at.
  if (liquidity === 0n) {
    return err("replan");
  }
  const squared = sqrtPriceX96 * sqrtPriceX96;
  return place.isToken0
    ? ok({
        price: { numerator: squared, denominator: q192 },
        depth: (liquidity * sqrtPriceX96) / q96,
      })
    : ok({
        price: { numerator: q192, denominator: squared },
        depth: (liquidity * q96) / sqrtPriceX96,
      });
}

/**
 * The token's price and its pool's depth from the answers of {@link poolReadCalls}. An answer
 * that failed, has another length than its function's, or holds a value past its type is
 * `unpriced`; a pair with an empty side, or a v3 pool with no liquidity in range, is `replan`.
 */
export function poolState(
  place: PoolPlace,
  answers: readonly ReadAnswer[],
): Result<PoolState, PriceMiss> {
  if (place.kind === "v2") {
    const [reserves, ...rest] = answers;
    const data = rest.length === 0 ? wordsIn(reserves, reservesWords) : undefined;
    return data === undefined ? err("unpriced") : reservesState(data, place);
  }
  const [slot0, liquidity, ...rest] = answers;
  const data = rest.length === 0 ? wordsIn(slot0, slot0Words) : undefined;
  const inRange = numberAnswer(liquidity);
  return data === undefined || inRange === undefined
    ? err("unpriced")
    : slot0State(data, inRange, place);
}

/**
 * The token's price, in base units of the quote for one base unit of it, from the answers of
 * {@link poolReadCalls}, as {@link poolState} reads it; a pool under its least depth is `replan`.
 */
export function poolPrice(
  place: PoolPlace,
  answers: readonly ReadAnswer[],
): Result<Ratio, PriceMiss> {
  const state = poolState(place, answers);
  if (!state.ok) {
    return state;
  }
  return state.value.depth < (place.minDepth ?? 0n) ? err("replan") : ok(state.value.price);
}
