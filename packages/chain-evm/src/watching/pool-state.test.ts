import { encodeAbiParameters, getAddress, type Hex } from "viem";
import { describe, expect, it } from "vitest";
import { addressAnswer, isToken0, numberAnswer, poolPrice } from "./pool-state.js";

const reserves = (reserve0: bigint, reserve1: bigint): Hex =>
  encodeAbiParameters(
    [{ type: "uint112" }, { type: "uint112" }, { type: "uint32" }],
    [reserve0, reserve1, 7],
  );

const slot0 = (sqrtPriceX96: bigint): Hex =>
  encodeAbiParameters(
    [
      { type: "uint160" },
      { type: "int24" },
      { type: "uint16" },
      { type: "uint16" },
      { type: "uint16" },
      { type: "uint32" },
      { type: "bool" },
    ],
    [sqrtPriceX96, -5, 1, 1, 1, 0, true],
  );

const wordsOf = (words: readonly bigint[]): Hex =>
  `0x${words.map((word) => word.toString(16).padStart(64, "0")).join("")}`;

const q96 = 2n ** 96n;
const unpriced = { ok: false, error: "unpriced" };

describe("pool state", () => {
  it("prices a token from a v2 pair's reserves on either side", () => {
    const answer = reserves(4n, 10n);
    expect(poolPrice({ kind: "v2", isToken0: true }, [answer])).toStrictEqual({
      ok: true,
      value: { numerator: 10n, denominator: 4n },
    });
    expect(poolPrice({ kind: "v2", isToken0: false }, [answer])).toStrictEqual({
      ok: true,
      value: { numerator: 4n, denominator: 10n },
    });
  });

  it("prices a token from a v3 pool's square root price on either side", () => {
    const answer = slot0(q96 * 3n);
    expect(poolPrice({ kind: "v3", isToken0: true }, [answer])).toStrictEqual({
      ok: true,
      value: { numerator: q96 * q96 * 9n, denominator: 2n ** 192n },
    });
    expect(poolPrice({ kind: "v3", isToken0: false }, [answer])).toStrictEqual({
      ok: true,
      value: { numerator: 2n ** 192n, denominator: q96 * q96 * 9n },
    });
  });

  it.each([
    ["a failed call", [undefined]],
    ["no answer", []],
    ["two answers", [reserves(1n, 1n), reserves(1n, 1n)]],
    ["an answer of another length", [slot0(q96)]],
    ["an empty side", [reserves(0n, 5n)]],
    ["a reserve past 112 bits", [wordsOf([2n ** 112n, 5n, 0n])]],
    ["text that is no hex", ["0xzz"]],
  ])("prices nothing from %s of a v2 pair", (_name, answers) => {
    expect(poolPrice({ kind: "v2", isToken0: true }, answers)).toStrictEqual(unpriced);
  });

  it("prices nothing from a v3 pool at a price of zero or past 160 bits", () => {
    expect(poolPrice({ kind: "v3", isToken0: true }, [slot0(0n)])).toStrictEqual(unpriced);
    const wide = wordsOf([2n ** 160n, 0n, 0n, 0n, 0n, 0n, 0n]);
    expect(poolPrice({ kind: "v3", isToken0: true }, [wide])).toStrictEqual(unpriced);
  });

  it("orders a pool's tokens by address, the lower first", () => {
    const low = getAddress("0x00000000000000000000000000000000000000aa");
    const high = getAddress("0xBB00000000000000000000000000000000000000");
    expect(isToken0(low, high)).toBe(true);
    expect(isToken0(high, low)).toBe(false);
  });

  it("reads one-word answers as an address or a number, and nothing else", () => {
    const pool = getAddress("0x1111111111111111111111111111111111111111");
    expect(addressAnswer(encodeAbiParameters([{ type: "address" }], [pool]))).toBe(pool);
    expect(addressAnswer(`0x${"f".repeat(64)}`)).toBeUndefined();
    expect(addressAnswer(undefined)).toBeUndefined();
    expect(numberAnswer(encodeAbiParameters([{ type: "uint256" }], [42n]))).toBe(42n);
    expect(numberAnswer(reserves(1n, 2n))).toBeUndefined();
  });
});
