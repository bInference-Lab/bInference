import { describe, expect, it } from "vitest";
import { writePricePath } from "./price-path.js";
import { readPricePath } from "./price-path.schema.js";

const path = {
  day: "2026-10-12",
  firstBlock: 127_111_629n,
  lastBlock: 127_303_028n,
  minMoveBps: 1,
  pools: [
    {
      symbol: "Cake",
      token: "0x0E09FaBB73Bd3Ade0a17ECC321fD13a19e81cE82",
      quote: "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c",
      pair: "0x0eD7e52944161450477ee417DE9Cd3a859b14fD0",
      tokenDecimals: 18,
      quoteDecimals: 18,
      blocks: [{ offset: 0n, reserveToken: 3n, reserveQuote: 1n, price: "0.333333333333333333" }],
    },
  ],
} as const;

describe("price paths", () => {
  it("reads back what it wrote", () => {
    expect(readPricePath(JSON.parse(writePricePath(path)))).toStrictEqual(path);
  });

  it("checksums the addresses it reads", () => {
    const text = writePricePath(path).replace(path.pools[0].pair, path.pools[0].pair.toLowerCase());

    expect(readPricePath(JSON.parse(text)).pools[0]?.pair).toBe(path.pools[0].pair);
  });

  it("refuses a pool with no block", () => {
    const text = writePricePath({ ...path, pools: [{ ...path.pools[0], blocks: [] }] });

    expect(() => readPricePath(JSON.parse(text))).toThrow(/Too small/);
  });
});
