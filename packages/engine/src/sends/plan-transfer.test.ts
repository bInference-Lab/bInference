import { accountRefSchema, assetRefSchema, chainRefSchema } from "@binference/chain";
import { err } from "@binference/core";
import { describe, expect, it } from "vitest";
import { testNowMs } from "../intents/test-intents.js";
import { testChains } from "../operations/test-engine.js";
import { planTransfer } from "./plan-transfer.js";

const chains = testChains();
const from = accountRefSchema.parse("fake:1:0x000000a1");
const to = accountRefSchema.parse("fake:1:0x000000b2");

function fakeChain() {
  const found = chains.get(chainRefSchema.parse("fake:1"));
  if (!found.ok) {
    throw new Error("The test registry lacks the fake chain.");
  }
  return found.value;
}

describe("a send's plan", () => {
  it("has no route for an asset its chain's family cannot draft", () => {
    const elsewhere = assetRefSchema.parse("fake:9/token:0x0000000a");
    const move = {
      kind: "send" as const,
      transfer: { from, to, amount: { asset: elsewhere, base: 5n } },
      payee: {},
    };
    expect(planTransfer(fakeChain(), move, { chains, nowMs: testNowMs })).toStrictEqual(
      err("no_route"),
    );
  });
});
