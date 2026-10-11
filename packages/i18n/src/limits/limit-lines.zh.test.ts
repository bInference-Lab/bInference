import { type ChainRegistry, createChainRegistry } from "@binference/chain";
import {
  createFakeChainDefinition,
  createFakeFamily,
  createFakeSigningScheme,
} from "@binference/chain/testing";
import { describe, expect, it } from "vitest";
import { createFormatter } from "../format/create-formatter.js";
import { limitLines } from "./limit-lines.js";

function testChains(): ChainRegistry {
  return createChainRegistry({
    chains: [createFakeChainDefinition()],
    families: [createFakeFamily()],
    signingSchemes: [createFakeSigningScheme()],
  });
}

const chinese = {
  formatter: createFormatter({ locale: "zh", timeZone: "UTC" }),
  chains: testChains(),
};

describe("an agent's limits in Chinese", () => {
  it("names each limit in the glossary's words", () => {
    const changes = { rollingDayUsdMicros: 1_000_000_000n, orderExpiryDays: 1, denyTokens: [] };
    expect(
      limitLines(changes, chinese).map(({ name, value }) => `${name}: ${value}`),
    ).toStrictEqual(["24 小时上限: $1,000.00", "禁止交易代币列表: 无", "自动订单的有效期: 1 天"]);
  });
});
