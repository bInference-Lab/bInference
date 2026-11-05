import type { ChainRegistry, RegisteredChain } from "@binference/chain";
import { fakeApprovalData, fakeDraft } from "@binference/chain/testing";
import { idSchema, type JsonValue, ok } from "@binference/core";
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
import { requestDocument } from "../intents/intent-documents.schema.js";
import type { IntentHistory } from "../intents/intent-history.js";
import type { IntentRecord } from "../intents/intent-record.js";
import {
  testAgent,
  testCoin,
  testNowMs,
  testSwap,
  testToken,
  testWallet,
} from "../intents/test-intents.js";
import { tokenLaunchQuoteDocument } from "../intents/token-launch-quote.js";
import { testLaunch } from "../money-path/test-launches.js";
import { testAccount, testCall, testCallers, testChains } from "../operations/test-engine.js";
import { stakeRequest } from "../staking/test-stakes.js";
import type { TransactionRecord } from "../wallet-queue/transaction-record.js";
import { createCardShowings } from "./create-card-showings.js";
import { liveReceiptOf } from "./live-receipt.js";

const live = () => ({ signal: new AbortController().signal });
const tokenSale = testSwap({ from: testToken, to: testCoin, amount: { base: 1_000_000n } });
const saleApproval = fakeDraft(testAccount, {
  to: "0x0000000a",
  value: 0n,
  data: fakeApprovalData("0x0000000b", 1_000_000n),
});

// The card receipts of the bench's stores, as the owner's surfaces read them, on the test chains
// or on given ones.
function showingsOf(bench: ExecutorBench, chains: ChainRegistry = testChains()) {
  return createCardShowings({
    ...bench.test.stores,
    chains,
    venues: { hasNoDeadline: () => false },
  });
}

// A registered chain with no block explorer listed.
function bare(chain: RegisteredChain): RegisteredChain {
  return { ...chain, definition: { ...chain.definition, explorers: [] } };
}

// The test chains with no block explorer listed for any of them.
function withoutExplorers(): ChainRegistry {
  const chains = testChains();
  return {
    get: (ref) => {
      const found = chains.get(ref);
      return found.ok ? ok(bare(found.value)) : found;
    },
    list: () => chains.list().map(bare),
  };
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
      tx: { explorerLink: `https://scan.example.invalid/tx/${hashOf(swap)}` },
    });
    expect(ended?.live?.assets).toMatchObject({
      [testCoin]: { symbol: "FAKE" },
      [testToken]: { symbol: "TKN" },
    });
  });

  it("names the last transaction's hash on a chain with no block explorer, never nothing sent", async () => {
    const bench = await startExecutorBench();
    const intent = await tapped(bench);
    await driveUntil(bench, intent, { states: ["reconciled"] });
    const [swap] = await transactionsOf(bench);
    const ended = await showingsOf(bench, withoutExplorers()).settled(intent, live());
    expect(ended?.live?.outcome).toStrictEqual({
      kind: "filled",
      fill: {
        amountIn: { asset: testCoin, base: 1_000_000n },
        amountOut: { asset: testToken, base: 2_000_000n },
      },
      tx: { hash: hashOf(swap) },
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
      tx: { explorerLink: `https://scan.example.invalid/tx/${hashOf(approval)}` },
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

const launchHash = "0xlaunch";
const intentId = idSchema("int").parse("int_0190f1c2-3a4b-7c5d-8e6f-000000000009");

// A live intent as the store keeps it, in the state given.
function liveRecord(change: Partial<IntentRecord>): IntentRecord {
  return {
    id: intentId,
    agentId: testAgent,
    walletId: testWallet,
    kind: "launchToken",
    state: "reconciled",
    request: requestDocument.encode(testLaunch),
    hasOutsideContent: false,
    isPaper: false,
    proposer: "telegram",
    createdAtMs: testNowMs,
    changedAtMs: testNowMs,
    version: 5,
    ...change,
  };
}

// The history of an intent whose last move's cause is the one given.
function endedWith(cause: JsonValue): IntentHistory {
  return {
    events: [{ id: 1, intentId, toState: "reconciled", cause, atMs: testNowMs }],
    cards: [],
  };
}

// The launch's trade as it reconciled: the coin it spent and what it got back.
const launchSettled = (got: { readonly asset: string; readonly base: string }) =>
  endedWith({
    settled: {
      amountIn: { asset: testCoin, base: "1500000" },
      amountOut: got,
      gas: { asset: testCoin, base: "1" },
      txHashes: [launchHash],
      atMs: testNowMs,
    },
  });

const launchQuote = tokenLaunchQuoteDocument.encode({
  venue: testLaunch.venue,
  settings: [],
  token: testToken,
  tokenDecimals: 18,
  fee: { asset: testCoin, base: 0n },
  pinWaitUntilMs: testNowMs,
  quotedAtMs: testNowMs,
});

// The receipt of the record with its history, on the test chains, with the transactions given.
async function receiptOf(
  record: IntentRecord,
  history: IntentHistory,
  sent: readonly TransactionRecord[] = [],
) {
  return liveReceiptOf(
    {
      record,
      history,
      transactions: { ofIntent: async () => sent },
      chains: testChains(),
      install: { read: async () => Promise.reject(new Error("The receipt read the install.")) },
    },
    live(),
  );
}

const launchLink = { explorerLink: `https://scan.example.invalid/tx/${launchHash}` };

describe("the receipt of a live intent read from its record", () => {
  it("names the launched token and a first buy that bought none of it", async () => {
    const record = liveRecord({ quote: launchQuote });
    const receipt = await receiptOf(record, launchSettled({ asset: testCoin, base: "0" }));
    expect(receipt?.outcome).toStrictEqual({
      kind: "launched",
      token: testToken,
      fill: { amountIn: testLaunch.firstBuy, amountOut: { asset: testToken, base: 0n } },
      tx: launchLink,
    });
  });

  it("names the token a launch got when no quote was kept, with no buy for a launch without one", async () => {
    const { firstBuy: _firstBuy, ...noBuy } = testLaunch;
    const record = liveRecord({ request: requestDocument.encode(noBuy) });
    const receipt = await receiptOf(record, launchSettled({ asset: testToken, base: "7" }));
    expect(receipt?.outcome).toStrictEqual({ kind: "launched", token: testToken, tx: launchLink });
  });

  it("says done for an intent that reconciled with no trade and no transaction", async () => {
    const record = liveRecord({ kind: "swap", request: requestDocument.encode(testSwap()) });
    const receipt = await receiptOf(record, endedWith({}));
    expect(receipt).toStrictEqual({ outcome: { kind: "done" }, assets: {} });
  });

  it("names the last transaction of an intent that reconciled with no trade to show", async () => {
    const record = liveRecord({ kind: "swap", request: requestDocument.encode(testSwap()) });
    const sent = { account: testAccount, hash: "0xlast" } as TransactionRecord;
    const receipt = await receiptOf(record, endedWith({}), [sent]);
    expect(receipt?.outcome).toStrictEqual({
      kind: "landed",
      tx: { explorerLink: "https://scan.example.invalid/tx/0xlast" },
    });
  });

  it("gives the asset of an amount a refusal names, so its words can show it", async () => {
    const record = liveRecord({
      kind: "stake",
      state: "failed_check",
      reason: "below_min_stake",
      request: requestDocument.encode(stakeRequest("stake")),
    });
    const history = endedWith({ named: { minStake: { asset: testCoin, base: "100" } } });
    const receipt = await receiptOf(record, history);
    expect(receipt?.outcome).toMatchObject({ kind: "refused", reason: "below_min_stake" });
    expect(receipt?.assets).toMatchObject({ [testCoin]: { symbol: "FAKE" } });
  });

  it("says nothing yet for a live intent still on its way", async () => {
    const record = liveRecord({ kind: "swap", state: "executing" });
    await expect(receiptOf(record, endedWith({}))).resolves.toBeUndefined();
  });

  it("says the chain is being read while a sent step's fate is unknown", async () => {
    const record = liveRecord({ kind: "swap", state: "unknown_after_send" });
    await expect(receiptOf(record, endedWith({}))).resolves.toStrictEqual({
      outcome: { kind: "unknown" },
      assets: {},
    });
  });

  it("draws no failure receipt for a failed intent with no transaction or no reason on record", async () => {
    const sent = { account: testAccount, hash: "0xlast" } as TransactionRecord;
    const failed = liveRecord({ kind: "swap", state: "failed_onchain", reason: "reverted" });
    const unreasoned = liveRecord({ kind: "swap", state: "failed_onchain" });
    await expect(receiptOf(failed, endedWith({}))).resolves.toBeUndefined();
    await expect(receiptOf(unreasoned, endedWith({}), [sent])).resolves.toBeUndefined();
  });
});
