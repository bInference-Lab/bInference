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
  "function balanceOf(address account) view returns (uint256 balance)",
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

/** The calldata of an ERC-20 token's `balanceOf(holder)`. */
export function balanceCallData(holder: Address): Hex {
  return encodeFunctionData({ abi: poolAbi, functionName: "balanceOf", args: [holder] });
}

/** The calldata of `getReserves()`. */
export const reservesCall: Hex = encodeFunctionData({ abi: poolAbi, functionName: "getReserves" });

/** The calldata of `slot0()`. */
export const slot0Call: Hex = encodeFunctionData({ abi: poolAbi, functionName: "slot0" });

/** The calldata of `liquidity()`. */
export const liquidityCall: Hex = encodeFunctionData({ abi: poolAbi, functionName: "liquidity" });

const wordBytes = 32;
const reservesWords = 3;
const slot0Words = 7;
const maxUint112 = 2n ** 112n - 1n;
const maxUint160 = 2n ** 160n - 1n;
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
}

function reservesPrice(answer: Hex, place: PoolPlace): Result<Ratio, PriceMiss> {
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
    ? ok({ numerator: reserve1, denominator: reserve0 })
    : ok({ numerator: reserve0, denominator: reserve1 });
}

// The square of the price in Q64.96 is token1 per token0 in Q192.
function slot0Price(answer: Hex, place: PoolPlace): Result<Ratio, PriceMiss> {
  const sqrtPriceX96 = wordOf(answer, 0);
  if (sqrtPriceX96 === 0n || sqrtPriceX96 > maxUint160) {
    return err("unpriced");
  }
  const squared = sqrtPriceX96 * sqrtPriceX96;
  return place.isToken0
    ? ok({ numerator: squared, denominator: q192 })
    : ok({ numerator: q192, denominator: squared });
}

/**
 * The token's price from its pool's one answer, in base units of the other token for one base unit
 * of it: a v2 pair's reserves or a v3 pool's `sqrtPriceX96`. An answer that failed, has another
 * length than its function's, or holds a value past its type is `unpriced`; a pair with an empty
 * side is `replan`.
 */
export function poolPrice(
  place: PoolPlace,
  answers: readonly ReadAnswer[],
): Result<Ratio, PriceMiss> {
  const [answer, ...rest] = answers;
  const words = place.kind === "v2" ? reservesWords : slot0Words;
  const data = rest.length === 0 ? wordsIn(answer, words) : undefined;
  if (data === undefined) {
    return err("unpriced");
  }
  return place.kind === "v2" ? reservesPrice(data, place) : slot0Price(data, place);
}
