import { accountRefSchema, assetRefSchema, type Venue } from "@binference/chain";
import { createFakeLaunchpad, createFakeVenue } from "@binference/chain/testing";
import { err } from "@binference/core";
import { createManualClock } from "@binference/core/testing";
import type { IntentRequest } from "@binference/protocol";
import { describe, expect, it, vi } from "vitest";
import { fixtureId } from "../contracts/store-fixtures.js";
import { testWalletRecord } from "../install/test-wallet-record.js";
import {
  testAgent,
  testCoin,
  testLimits,
  testNowMs,
  testToken,
  testWallet,
} from "../intents/test-intents.js";
import { testChains } from "../operations/test-engine.js";
import type { RiskCheck } from "../ports.js";
import { createCardShowings } from "../surfaces/create-card-showings.js";
import { createVenueHost, type VenueHost } from "../venues/venue-host.js";
import {
  type BenchOptions,
  driveUntil,
  type ExecutorBench,
  flush,
  startExecutorBench,
  tapped,
} from "./test-executor.js";

// A launch wallet's curve trades in the wallet queue (decision 0218): the queue reads the launch's
// contracts as it takes the intent and before each later step, and signs nothing it cannot read.
const live = { signal: new AbortController().signal };
const curve = "fake-curve";
const launchCurve = accountRefSchema.parse("fake:1:0x000000c1");
const unlisted = assetRefSchema.parse("fake:1/token:0x0000000f");
const launchWallet = fixtureId("wal", 218);
const launchAccount = accountRefSchema.parse("fake:1:0x000000d9");
const chains = testChains([curve]);
const prices = new Map([
  [testCoin, { numerator: 600n, denominator: 10n ** 12n }],
  [testToken, { numerator: 1n, denominator: 1n }],
]);
const passing: RiskCheck = {
  assess: async () =>
    await Promise.resolve({
      view: { verdict: "pass", flags: [], onCurve: false, checkedAt: testNowMs },
    }),
};

type Curves = VenueHost["curves"];

// The launchpad holds the token on a curve of its own against the registry's token, so a buy
// approves the curve, then buys; no test moves the token off it.
const venues: readonly Venue[] = [
  createFakeVenue(),
  createFakeLaunchpad({ onCurve: [unlisted], quoteAsset: testToken, launchCurve }),
];
const host = createVenueHost({
  venues,
  chains,
  clock: createManualClock(testNowMs),
  callTimeoutMs: 5_000,
});
const realOf: Curves = async (token, call) => host.curves(token, call);

// A live agent with its launch wallet, whose executor reads the launch through `reads`.
async function benchOf(
  reads: (real: Curves) => Curves,
  options: Pick<BenchOptions, "limits"> = {},
): Promise<ExecutorBench> {
  const wallets = [testWallet, launchWallet];
  const bench = await startExecutorBench({
    ...options,
    agent: { limits: { ...testLimits, venues: ["fake-swap", curve] } },
    prices,
    engine: {
      chains,
      venues,
      risk: passing,
      prices,
      wallets,
      custodyWallets: new Map([[launchWallet, launchAccount]]),
    },
    launch: { venues, chains, wallets, curves: { curves: reads(realOf) } },
  });
  bench.test.stores.install.addWallet(
    testWalletRecord({
      id: launchWallet,
      agentId: testAgent,
      label: "curves",
      createdAtMs: testNowMs,
      role: "launch",
    }),
  );
  return bench;
}

const buy: IntentRequest = {
  kind: "buy",
  agent: testAgent,
  reason: "Buy the launch",
  token: unlisted,
  spend: { asset: testToken, base: 1_000n },
};

async function reasonOf(bench: ExecutorBench, intent: ReturnType<typeof fixtureId<"int">>) {
  const record = await bench.test.stores.intents.get(intent, live);
  return [record?.state, record?.reason];
}

function noticesOf(bench: ExecutorBench): readonly unknown[] {
  return bench.pushes.filter((push) => push.topic === "notice").map((push) => push.data);
}

describe("a launch wallet's curve trade in the wallet queue", () => {
  it("signs every step with the launch's curve read again", async () => {
    const bench = await benchOf((real) => real);

    const intent = await tapped(bench, buy);

    await expect(driveUntil(bench, intent, { states: ["reconciled"] })).resolves.toBe("reconciled");
    expect(bench.signed.map((request) => request.allowed.launch)).toStrictEqual([
      [launchCurve],
      [launchCurve],
    ]);
  });

  it("ends a trade whose launch read fails as the queue takes it, and signs nothing", async () => {
    const reads = vi.fn<Curves>().mockResolvedValue(err("venue_down"));
    const bench = await benchOf(() => reads);

    const intent = await tapped(bench, buy);
    await driveUntil(bench, intent, { states: ["failed_check"] });

    await expect(reasonOf(bench, intent)).resolves.toStrictEqual(["failed_check", "launch_unread"]);
    expect(bench.signed).toStrictEqual([]);
    const showings = createCardShowings({
      ...bench.test.stores,
      chains: testChains(),
      venues: { hasNoDeadline: () => false },
    });
    const ended = await showings.settled(intent, { signal: AbortSignal.timeout(5_000) });
    expect(ended?.live?.outcome).toStrictEqual({ kind: "refused", reason: "launch_unread" });
    expect(noticesOf(bench)).toMatchObject([
      { key: "notice.launchUnsent", intent, values: { reason: "launch_unread" } },
    ]);
  });

  it("ends a trade whose token left the curve before the queue took it", async () => {
    const reads = vi.fn<Curves>().mockResolvedValue({ ok: true, value: [] });
    const bench = await benchOf(() => reads);

    const intent = await tapped(bench, buy);
    await driveUntil(bench, intent, { states: ["failed_check"] });

    await expect(reasonOf(bench, intent)).resolves.toStrictEqual(["failed_check", "launch_moved"]);
    expect(bench.signed).toStrictEqual([]);
  });

  it("never signs a later step whose launch read fails, and says the trade stopped", async () => {
    const bench = await benchOf((real) =>
      vi.fn<Curves>().mockImplementationOnce(real).mockResolvedValue(err("venue_down")),
    );

    const intent = await tapped(bench, buy);
    await driveUntil(bench, intent, { states: ["failed_onchain"] });

    await expect(reasonOf(bench, intent)).resolves.toStrictEqual(["failed_onchain", "step_unsent"]);
    expect(bench.signed.map((request) => request.step.index)).toStrictEqual([0]);
    expect(noticesOf(bench)).toMatchObject([{ key: "notice.stepUnsent", intent }]);
  });
});

// The stuck rules run at 3 and 6 blocks; the network holds back the first step's fee, so it sticks.
const stuckLimits = { stuckAfterBlocks: 3, replaceAfterBlocks: 6, droppedAfterBlocks: 9 };

describe("a launch wallet's stuck step", () => {
  it("is cancelled, not sped up, once its token left the curve", async () => {
    const reads = vi
      .fn<Curves>()
      .mockImplementationOnce(async (token, call) => realOf(token, call))
      .mockResolvedValue({ ok: true, value: [] });
    const bench = await benchOf(() => reads, { limits: stuckLimits });
    bench.network.holdBelow(52_000_000n);

    const intent = await tapped(bench, buy);
    await flush();
    await driveUntil(bench, intent, { states: ["failed_onchain"] });

    await expect(reasonOf(bench, intent)).resolves.toStrictEqual([
      "failed_onchain",
      "stuck_cancelled",
    ]);
    expect(bench.signed.map((request) => request.step.replaces?.kind)).toStrictEqual([
      undefined,
      "cancel",
    ]);
  });

  it("waits to speed up while its launch cannot be read, then signs with the read", async () => {
    const reads = vi
      .fn<Curves>()
      .mockImplementationOnce(async (token, call) => realOf(token, call))
      .mockResolvedValueOnce(err("venue_down"))
      .mockImplementation(async (token, call) => realOf(token, call));
    const bench = await benchOf(() => reads, { limits: stuckLimits });
    bench.network.holdBelow(52_000_000n);

    const intent = await tapped(bench, buy);
    await flush();
    await driveUntil(bench, intent, { states: ["reconciled"] });

    // Each step sticks once and is sped up, never cancelled, the first after the failed read.
    const replaced = bench.signed.filter((request) => request.step.replaces !== undefined);
    expect(
      replaced.map((request) => [
        request.step.index,
        request.step.replaces?.kind,
        request.allowed.launch,
      ]),
    ).toStrictEqual([
      [0, "speedUp", [launchCurve]],
      [1, "speedUp", [launchCurve]],
    ]);
  });
});
