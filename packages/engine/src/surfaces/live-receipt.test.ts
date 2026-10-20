import { fakeApprovalData, fakeDraft } from "@binference/chain/testing";
import { describe, expect, it } from "vitest";
import {
  driveUntil,
  type ExecutorBench,
  flush,
  hashOf,
  startExecutorBench,
  tapped,
  transactionsOf,
} from "../executor/test-executor.js";
import { testAgent, testCoin, testSwap, testToken } from "../intents/test-intents.js";
import { testAccount, testCall, testCallers, testChains } from "../operations/test-engine.js";
import { createCardShowings } from "./create-card-showings.js";

const live = () => ({ signal: new AbortController().signal });
const tokenSale = testSwap({ from: testToken, to: testCoin, amount: { base: 1_000_000n } });
const saleApproval = fakeDraft(testAccount, {
  to: "0x0000000a",
  value: 0n,
  data: fakeApprovalData("0x0000000b", 1_000_000n),
});

// The card receipts of the bench's stores, as the owner's surfaces read them.
function showingsOf(bench: ExecutorBench) {
  return createCardShowings({
    ...bench.test.stores,
    chains: testChains(),
    venues: { hasNoDeadline: () => false },
  });
}

describe("the receipt of a confirmed live intent", () => {
  it("says it is sending until the trade ends, then what it sold and bought, with its link", async () => {
    const bench = await startExecutorBench({ hold: true });
    const intent = await tapped(bench);
    const sending = await showingsOf(bench).settled(intent, live());
    await bench.release();
    await expect(driveUntil(bench, intent, { states: ["reconciled"] })).resolves.toBe("reconciled");
    const ended = await showingsOf(bench).settled(intent, live());
    const [swap] = await transactionsOf(bench);
    expect([sending?.closing.outcome, sending?.live]).toStrictEqual(["confirmed", undefined]);
    expect(ended?.live?.outcome).toStrictEqual({
      kind: "filled",
      fill: {
        amountIn: { asset: testCoin, base: 1_000_000n },
        amountOut: { asset: testToken, base: 2_000_000n },
      },
      explorerLink: `https://scan.example.invalid/tx/${hashOf(swap)}`,
    });
    expect(ended?.live?.assets).toMatchObject({
      [testCoin]: { symbol: "FAKE" },
      [testToken]: { symbol: "TKN" },
    });
  });

  it("says why a step failed on chain, with the link of the step that did", async () => {
    const bench = await startExecutorBench({ network: { reverting: [saleApproval.payload] } });
    const intent = await tapped(bench, tokenSale);
    await driveUntil(bench, intent, { states: ["failed_onchain"] });
    const [approval] = await transactionsOf(bench);
    const ended = await showingsOf(bench).settled(intent, live());
    expect(ended?.live?.outcome).toStrictEqual({
      kind: "failed",
      reason: "reverted",
      explorerLink: `https://scan.example.invalid/tx/${hashOf(approval)}`,
    });
  });

  it("says a confirmed trade whose confirmation lapsed before the queue was not sent", async () => {
    const bench = await startExecutorBench({ hold: true });
    const intent = await tapped(bench);
    await bench.test.clock.advance(61_000);
    await bench.release();
    await flush();
    const ended = await showingsOf(bench).settled(intent, live());
    expect(ended?.live?.outcome).toStrictEqual({ kind: "unsent" });
  });

  it("says a confirmed trade a freeze cancelled before the queue was not sent", async () => {
    const bench = await startExecutorBench({ hold: true });
    const intent = await tapped(bench);
    const frozen = await bench.test.engine.handlers["safety/freeze"](
      testCall({ agent: testAgent }, testCallers.cli),
    );
    await bench.release();
    await flush();
    const ended = await showingsOf(bench).settled(intent, live());
    expect([frozen.ok, ended?.live?.outcome]).toStrictEqual([true, { kind: "unsent" }]);
  });
});
