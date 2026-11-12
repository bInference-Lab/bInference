import type { DaySumsRefusal, Signer } from "@binference/chain";
import { BinferenceError, type Id } from "@binference/core";
import { describe, expect, it } from "vitest";
import { testCoin, testSwap, testToken } from "../intents/test-intents.js";
import {
  benchChain,
  type BenchOptions,
  driveUntil,
  type ExecutorBench,
  eventsOf,
  flush,
  startExecutorBench,
  stateOf,
  tapped,
  transactionsOf,
} from "./test-executor.js";

const live = () => ({ signal: new AbortController().signal });

const sums: DaySumsRefusal = {
  chain: benchChain,
  asset: testCoin,
  capBase: 10n ** 19n,
  usedBase: 95n * 10n ** 17n,
  askedBase: 10n ** 18n,
  roomAtMs: 1_800_000_000_000,
};

const tokenSale = testSwap({ from: testToken, to: testCoin, amount: { base: 1_000_000n } });

async function reasonOf(bench: ExecutorBench, intent: Id<"int">) {
  return (await bench.test.stores.intents.get(intent, live()))?.reason;
}

// The notices the executor sent, oldest first.
function noticesOf(bench: ExecutorBench): readonly unknown[] {
  return bench.pushes.filter(({ kind }) => kind === "notice/new").map(({ data }) => data);
}

function noticeKeysOf(bench: ExecutorBench): readonly string[] {
  return noticesOf(bench).map(
    (notice) => /"key":"([^"]+)"/.exec(JSON.stringify(notice))?.[1] ?? "",
  );
}

// A custody that answers over the user's sums from the step `from` on, and signs before it.
function fullFrom(from: number): (custody: Signer) => Signer {
  return (custody: Signer): Signer => ({
    account: async (wallet, chain, options) => custody.account(wallet, chain, options),
    signTransaction: async (request, options) =>
      request.step.index >= from
        ? { ok: false, error: "over_sums", sums }
        : custody.signTransaction(request, options),
  });
}

const downCustody = (custody: Signer): Signer => ({
  account: async (wallet, chain, options) => custody.account(wallet, chain, options),
  signTransaction: async () => {
    throw new BinferenceError({
      code: "custody.signer_down",
      message: "No answer.",
      retryable: true,
    });
  },
});

async function heldTap(options: BenchOptions = {}) {
  const bench = await startExecutorBench({ ...options, hold: true });
  return { bench, intent: await tapped(bench) };
}

describe("the executor on a signer service's refusals", () => {
  it("cancels an intent whose first step would pass the user's 24-hour sums, asking once", async () => {
    const { bench, intent } = await heldTap();
    bench.test.custody.fillSums(sums);
    await bench.release();
    await flush();
    expect(await stateOf(bench, intent)).toBe("cancelled");
    expect(await reasonOf(bench, intent)).toBe("day_sums");
    expect(noticesOf(bench)).toMatchObject([
      {
        key: "notice.daySums",
        values: { chain: "Fake One" },
        amounts: {
          cap: { asset: testCoin, base: "10000000000000000000" },
          used: { asset: testCoin, base: "9500000000000000000" },
        },
        times: { room: sums.roomAtMs },
      },
    ]);
    expect(bench.signed).toHaveLength(1);
    expect(await transactionsOf(bench)).toStrictEqual([]);
    expect(bench.network.sends()).toBe(0);
  });

  it("cancels an intent the signer service answers locked, asking once", async () => {
    const { bench, intent } = await heldTap();
    bench.test.custody.lock("breaker");
    await bench.release();
    await flush();
    expect(await stateOf(bench, intent)).toBe("cancelled");
    expect(await reasonOf(bench, intent)).toBe("signer_locked");
    expect(eventsOf(bench).slice(-2)).toStrictEqual([
      "executor.step_stopped:locked",
      "executor.step_unsent:cancelled",
    ]);
    expect(noticeKeysOf(bench)).toStrictEqual(["notice.notSigned"]);
    expect(bench.signed).toHaveLength(1);
  });

  it("fails an intent with day_sums when a later step would pass the sums", async () => {
    const bench = await startExecutorBench({ custody: fullFrom(1) });
    const intent = await tapped(bench, tokenSale);
    await driveUntil(bench, intent, { states: ["failed_onchain"], blocks: 3 });
    expect(await stateOf(bench, intent)).toBe("failed_onchain");
    expect(await reasonOf(bench, intent)).toBe("day_sums");
    expect(noticeKeysOf(bench)).toStrictEqual(["notice.daySums"]);
    expect((await transactionsOf(bench)).map(({ step }) => step)).toStrictEqual([0]);
    expect(bench.signed.map(({ step }) => step.index)).toStrictEqual([0, 1]);
  });

  it("cancels an intent whose signer service is down, and asks nothing again", async () => {
    const { bench, intent } = await heldTap({ custody: downCustody });
    await bench.release();
    await driveUntil(bench, intent, { states: [], blocks: 5 });
    expect(await stateOf(bench, intent)).toBe("cancelled");
    expect(eventsOf(bench)).toContain("executor.sign_failed:custody.signer_down");
    expect(noticeKeysOf(bench)).toStrictEqual(["notice.notSigned"]);
    expect(bench.signed).toHaveLength(1);
  });
});
