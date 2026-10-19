import {
  type AccountRef,
  accountRefParts,
  type AssetTransfer,
  assetRefSchema,
  printAccountRef,
} from "@binference/chain";
import {
  createFakeLauncher,
  createFakeLaunchpad,
  createFakeVenue,
  type FakeSent,
} from "@binference/chain/testing";
import { createManualClock } from "@binference/core/testing";
import { describe, expect, it } from "vitest";
import { createMemoryLaunchImages } from "../fakes/memory-launch-images.js";
import { testWalletRecord } from "../install/test-wallet-record.js";
import {
  expectOk,
  testAgent,
  testCoin,
  testLimits,
  testNowMs,
  testWallet,
} from "../intents/test-intents.js";
import {
  testLaunch,
  testLaunchAccount,
  testLaunchSimulator,
  testLaunchWallet,
  testPad,
} from "../money-path/test-launches.js";
import { testCallers, testChains } from "../operations/test-engine.js";
import { createVenueHost } from "../venues/venue-host.js";
import type { TransactionRecord } from "../wallet-queue/transaction-record.js";
import { driveUntil, type ExecutorBench, startExecutorBench, tapped } from "./test-executor.js";

// A token launch in the wallet queue (decision 0234): signed from the launch wallet, to the
// launchpad's registry contracts alone, and settled with its first buy as a position.
const live = { signal: new AbortController().signal };
const chains = testChains([testPad]);
const token = assetRefSchema.parse("fake:1/token:0x000000e1");
const launcher = createFakeLauncher();
const venues = [createFakeVenue(), createFakeLaunchpad({ onCurve: [], launcher })];
const curves = createVenueHost({
  venues,
  chains,
  clock: createManualClock(testNowMs),
  callTimeoutMs: 5_000,
});
// The test launch with no launchpad setting, which this launchpad declares none of.
const { venueOptions: _settings, ...launch } = testLaunch;
const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1]);

// What a fake create call moved once a block holds it: its value from the wallet to the
// launchpad's router, and the first buy's minimum of the token back.
function launchTransfers(sent: FakeSent): readonly AssetTransfer[] {
  const [to = "", value = "0", data = ""] = sent.draftPayload.split("|");
  const words = data.split(",");
  const router = printAccountRef({ chain: accountRefParts(sent.account).chain, address: to });
  if (words[0] !== "launch" || !router.ok) {
    return [];
  }
  const paid = {
    from: sent.account,
    to: router.value,
    amount: { asset: testCoin, base: BigInt(value) },
  };
  const minOut = words[8] ?? "";
  const got = {
    from: router.value,
    to: sent.account,
    amount: { asset: token, base: BigInt(minOut) },
  };
  return minOut === "" ? [paid] : [paid, got];
}

async function benchOf(): Promise<ExecutorBench> {
  const wallets = [testWallet, testLaunchWallet];
  const bench = await startExecutorBench({
    agent: { limits: { ...testLimits, venues: ["fake-swap", testPad] } },
    network: { transfers: launchTransfers, nativeReceived: () => 0n },
    engine: {
      chains,
      venues,
      wallets,
      custodyWallets: new Map<typeof testLaunchWallet, AccountRef>([
        [testLaunchWallet, testLaunchAccount],
      ]),
      chainSimulator: testLaunchSimulator(launcher),
      launchImages: createMemoryLaunchImages(
        new Map([["upl_moon", png]]),
        testCallers.cli.credential,
      ),
    },
    launch: { venues, chains, wallets, curves },
  });
  const record = {
    id: testLaunchWallet,
    agentId: testAgent,
    label: "launches",
    createdAtMs: testNowMs,
  };
  bench.test.stores.install.addWallet(testWalletRecord({ ...record, role: "launch" }));
  return bench;
}

// What the transactions paid for gas, from their receipts.
function gasPaid(stored: readonly TransactionRecord[]): bigint {
  return stored.reduce(
    (sum, { receipt }) => sum + (receipt?.gasUsed ?? 0n) * (receipt?.feePerGasBase ?? 0n),
    0n,
  );
}

// The launch wallet holds `base` of the coin as a live position, each unit at one micro-dollar.
async function holdCoin(bench: ExecutorBench, base: bigint): Promise<void> {
  const walletId = testLaunchWallet;
  const arrival = { walletId, isPaper: false, atMs: 1, received: { asset: testCoin, base } };
  const position = {
    walletId,
    asset: testCoin,
    isPaper: false,
    quantityBase: base,
    costUsdMicros: base,
    realizedUsdMicros: 0n,
    changedAtMs: 1,
  };
  const write = { arrival: { ...arrival, valueUsdMicros: base }, positions: [{ position }] };
  expectOk(await bench.test.positions.recordArrival(write, live));
}

describe("a token launch in the wallet queue", () => {
  it("signs its create call to the launchpad's router alone, from the launch wallet", async () => {
    const bench = await benchOf();
    const intent = await tapped(bench, launch);

    await expect(driveUntil(bench, intent, { states: ["reconciled"] })).resolves.toBe("reconciled");
    expect(bench.signed.map((request) => [request.wallet, request.allowed.launch])).toStrictEqual([
      [testLaunchWallet, undefined],
    ]);
    expect(bench.signed[0]?.allowed.contracts).toStrictEqual(["fake:1:0x0000000d"]);
  });

  it("opens a position with the first buy, the launch fee as its fee", async () => {
    const bench = await benchOf();
    const intent = await tapped(bench, launch);
    await driveUntil(bench, intent, { states: ["reconciled"] });

    const query = { isPaper: false, walletId: testLaunchWallet, after: 0, limit: 10 };
    const executions = await bench.test.positions.executions(query, live);
    expect(executions).toMatchObject([
      {
        intentId: intent,
        sold: { asset: testCoin, base: 1_000_000n },
        feeBase: 2_000n,
        bought: { asset: token, base: 970_000_000n },
      },
    ]);
  });

  it("takes a launch's fee and gas out of the coin it holds when it buys nothing", async () => {
    const bench = await benchOf();
    await holdCoin(bench, 10n ** 18n);
    const { firstBuy: _buy, ...feeOnly } = launch;
    const intent = await tapped(bench, feeOnly);

    await expect(driveUntil(bench, intent, { states: ["reconciled"] })).resolves.toBe("reconciled");
    const query = { isPaper: false, walletId: testLaunchWallet, after: 0, limit: 10 };
    await expect(bench.test.positions.executions(query, live)).resolves.toStrictEqual([]);
    const stored = await bench.test.stores.transactions.ofIntent(intent, live);
    const gas = gasPaid(stored);
    expect(gas).toBeGreaterThan(0n);
    const held = await bench.test.positions.positions(
      { walletId: testLaunchWallet, isPaper: false },
      live,
    );
    expect(held.map(({ asset, quantityBase }) => [asset, quantityBase])).toStrictEqual([
      [testCoin, 10n ** 18n - 2_000n - gas],
    ]);
  });
});
