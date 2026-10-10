import { assetRefSchema, chainRefSchema } from "@binference/chain";
import { bsc } from "@binference/chains";
import { createManualClock, createScriptedHttp } from "@binference/core/testing";
import { describe, expect, it } from "vitest";
import { composeChainReads } from "./chain-reads.js";
import { selfHostedChains } from "./open-engine-parts.js";
import { paperBalancesOf } from "./paper-balances.js";

const bscRef = chainRefSchema.parse(bsc.id);
const config = { enabled: [bscRef], rpc: {}, relays: {}, maxFeePerGasGwei: { [bscRef]: "1" } };
const reads = composeChainReads({
  chains: selfHostedChains(),
  config,
  http: createScriptedHttp([]),
  clock: createManualClock(),
});

describe("the paper starting balances", () => {
  it("reads each symbol as the coin or a registry token of an enabled chain, in base units", () => {
    expect(paperBalancesOf({ BNB: "1", USDT: "500.25" }, reads)).toStrictEqual([
      { asset: assetRefSchema.parse(`${bsc.id}/slip44:714`), base: 10n ** 18n },
      {
        asset: assetRefSchema.parse(`${bsc.id}/erc20:0x55d398326f99059fF775485246999027B3197955`),
        base: 50_025n * 10n ** 16n,
      },
    ]);
    expect(paperBalancesOf({}, reads)).toStrictEqual([]);
  });

  it.each([
    ["a symbol no enabled chain lists", { DOGE: "1" }, "DOGE"],
    ["more decimals than the asset has", { BNB: "0.0000000000000000001" }, "BNB"],
  ])("refuses %s", (_case, balances, symbol) => {
    expect(() => paperBalancesOf(balances, reads)).toThrow(
      expect.objectContaining({ code: "cli.bad_paper_balance", details: { symbol } }),
    );
    expect(() => paperBalancesOf({ BNB: "1" }, new Map())).toThrow(
      expect.objectContaining({ code: "cli.bad_paper_balance" }),
    );
  });
});
