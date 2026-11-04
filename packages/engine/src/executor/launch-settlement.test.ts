import { assetRefSchema, type TxHash } from "@binference/chain";
import { err, type Id, ok } from "@binference/core";
import { createMemoryLogger } from "@binference/core/testing";
import { describe, expect, it } from "vitest";
import { fixtureId } from "../contracts/store-fixtures.js";
import type { IntentRecord } from "../intents/intent-record.js";
import { testAgent, testCoin, testNowMs, testWallet } from "../intents/test-intents.js";
import { type TokenLaunchQuote, tokenLaunchQuoteDocument } from "../intents/token-launch-quote.js";
import type { DepartureDraft } from "../positions/departure-record.js";
import type { ExecutionRun } from "./executor-run.js";
import { departLaunch } from "./launch-settlement.js";

// Decision 0234: a launch that bought nothing takes its fees out of its wallet's coin as a
// departure, once; a store that refuses it is logged and tried again at the next block.
const token = assetRefSchema.parse("fake:1/token:0x000000e1");
const txHash = `0x${"cd".repeat(32)}` as TxHash;
const live = { signal: new AbortController().signal };

function launchRecord(feeBase: bigint, firstBuy?: bigint): IntentRecord {
  const buy =
    firstBuy === undefined
      ? {}
      : { firstBuy: { spend: { asset: testCoin, base: firstBuy }, expectedOut: 1n, minOut: 1n } };
  const quote: TokenLaunchQuote = {
    venue: "fake-curve",
    settings: [],
    token,
    tokenDecimals: 18,
    fee: { asset: testCoin, base: feeBase },
    ...buy,
    pinWaitUntilMs: testNowMs,
    quotedAtMs: testNowMs,
  };
  return {
    id: fixtureId("int", 3),
    agentId: testAgent,
    walletId: testWallet,
    kind: "launchToken",
    state: "finalized",
    request: {},
    hasOutsideContent: false,
    isPaper: false,
    proposer: "telegram",
    createdAtMs: testNowMs,
    changedAtMs: testNowMs,
    version: 1,
    quote: tokenLaunchQuoteDocument.encode(quote),
  };
}

/** A run whose positions answer each departure as told, noting what it was asked to store. */
function runWith(answer: "stored" | "refused") {
  const asked: { readonly intentId: Id<"int">; readonly departures: readonly DepartureDraft[] }[] =
    [];
  const logger = createMemoryLogger({ subsystem: "engine" });
  const depart = async (departed: (typeof asked)[number]) => {
    asked.push(departed);
    return answer === "stored" ? ok([]) : err("store.conflict");
  };
  const run = {
    parts: { valuedPositions: { depart }, log: logger },
    signal: live.signal,
  } as unknown as ExecutionRun;
  return { run, asked, logger };
}

const paid = (gasBase: bigint) => ({ gas: { asset: testCoin, base: gasBase }, atMs: 1, txHash });

describe("a token launch that bought nothing, as it settles", () => {
  it("takes its launch fee and its gas out of its wallet's coin as one departure", async () => {
    const { run, asked } = runWith("stored");
    await expect(departLaunch(run, launchRecord(2_000n), paid(30n))).resolves.toBe(true);
    expect(asked).toMatchObject([
      {
        departures: [
          {
            walletId: testWallet,
            sent: { asset: testCoin, base: 2_000n },
            gas: { asset: testCoin, base: 30n },
            txHash,
          },
        ],
      },
    ]);
  });

  it("takes its gas alone out when its launchpad charged no fee", async () => {
    const { run, asked } = runWith("stored");
    await expect(departLaunch(run, launchRecord(0n), paid(30n))).resolves.toBe(true);
    expect(asked).toMatchObject([
      {
        departures: [{ sent: { asset: testCoin, base: 30n }, gas: { asset: testCoin, base: 0n } }],
      },
    ]);
  });

  it("stores nothing for a launch that paid nothing, or one whose first buy books a trade", async () => {
    const { run, asked } = runWith("stored");
    await expect(departLaunch(run, launchRecord(0n), paid(0n))).resolves.toBe(true);
    await expect(departLaunch(run, launchRecord(2_000n, 5n), paid(30n))).resolves.toBe(true);
    expect(asked).toStrictEqual([]);
  });

  it("logs a departure the store refuses, so the executor tries again at the next block", async () => {
    const { run, logger } = runWith("refused");
    await expect(departLaunch(run, launchRecord(2_000n), paid(30n))).resolves.toBe(false);
    expect(logger.records().map(({ event }) => event)).toStrictEqual(["executor.settle_waits"]);
  });
});
