import {
  assetRefSchema,
  type ChainRegistry,
  chainRefSchema,
  createChainRegistry,
} from "@binference/chain";
import {
  createFakeChainDefinition,
  createFakeFamily,
  createFakeSigningScheme,
} from "@binference/chain/testing";
import { bpsSchema } from "@binference/core";
import type { LimitChanges } from "@binference/protocol";
import { describe, expect, it } from "vitest";
import { createFormatter } from "../format/create-formatter.js";
import { type LimitDisplay, limitLines } from "./limit-lines.js";

function testChains(): ChainRegistry {
  return createChainRegistry({
    chains: [createFakeChainDefinition()],
    families: [createFakeFamily()],
    signingSchemes: [createFakeSigningScheme()],
  });
}

const english: LimitDisplay = {
  formatter: createFormatter({ locale: "en", timeZone: "UTC" }),
  chains: testChains(),
};
const fakeChain = chainRefSchema.parse("fake:1");
const otherChain = chainRefSchema.parse("eip155:999");
const token = assetRefSchema.parse("fake:1/erc20:0x0000000a");

function lines(changes: LimitChanges) {
  return limitLines(changes, english).map(({ name, value }) => `${name}: ${value}`);
}

describe("an agent's limits as people read them", () => {
  it("reads dollars, rates, times and health factors in the order every surface lists them", () => {
    const changes: LimitChanges = {
      orderExpiryDays: 30,
      perTradeUsdMicros: 250_000_000n,
      slippageRegistryBps: bpsSchema.parse(50),
      minHealthFactorBps: 15_000,
      cardTradeExpirySeconds: 1,
      cardOtherExpirySeconds: 600,
    };
    expect(lines(changes)).toStrictEqual([
      "Per-trade cap: $250.00",
      "Slippage limit on verified tokens: 0.50%",
      "Lowest health factor: 1.5",
      "How long a trade card waits: 1 second",
      "How long other cards wait: 600 seconds",
      "How long an auto order lasts: 30 days",
    ]);
  });

  it("says what an empty list allows, and lists the rest", () => {
    expect(
      lines({ allowTokens: [], denyTokens: [], venues: ["fake-swap", "other"] }),
    ).toStrictEqual([
      "Venues it may use: fake-swap, other",
      "Tokens it may trade: every token that passes the risk check",
      "Tokens it may not trade: none",
    ]);
    expect(lines({ denyTokens: [token] })).toStrictEqual([`Tokens it may not trade: ${token}`]);
  });

  it("reads a gas reserve in the chain's coin, or in base units on a chain this install lacks", () => {
    const changes: LimitChanges = {
      gasReserve: { [fakeChain]: 3n * 10n ** 15n, [otherChain]: 7n },
    };
    expect(limitLines(changes, english)).toStrictEqual([
      {
        field: "gasReserve",
        chain: fakeChain,
        name: "Gas reserve",
        value: "0.003 FAKE on Fake One",
      },
      {
        field: "gasReserve",
        chain: otherChain,
        name: "Gas reserve",
        value: "7 of the native coin on eip155:999, in base units",
      },
    ]);
  });

  it("leaves out every limit the changes do not hold", () => {
    expect(lines({})).toStrictEqual([]);
  });
});
