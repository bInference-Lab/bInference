import { type AccountRef, accountRefSchema, assetRefSchema } from "@binference/chain";
import { bsc } from "@binference/chains";
import {
  type FakeCeilingEditor,
  fakeOwnerKeyCode,
  testNowMs,
  testWallet,
} from "@binference/engine/testing";
import { createFormatter, messages } from "@binference/i18n";
import type { DayCapView } from "@binference/protocol";
import { afterEach, describe, expect, it } from "vitest";
import { skeletonCompositions } from "../compose/test-skeleton.js";
import { runCli } from "../program/run-cli.js";
import { createScriptedPrompter, type ScriptedAnswer } from "../term/scripted-prompter.js";
import { type ServedSkeleton, serveSkeleton } from "./skeleton-machine.js";
import { createTestMachines, hostWith, runOn, type TestMachine } from "./test-host.js";

const slow = { timeout: 60_000 };
const machines = createTestMachines();
const served: ServedSkeleton[] = [];
const live = { signal: new AbortController().signal };
const [selfHosted] = skeletonCompositions;
const english = createFormatter({ locale: "en", timeZone: "UTC" });
const en = (key: string, values: Readonly<Record<string, string | number>> = {}): string =>
  english.message(`cli.${key}`, values);
const owner = accountRefSchema.parse("fake:1:0x000000a1");
const router = accountRefSchema.parse("fake:1:0x0000000b");
const ownerAddress = "0x30435f9D276c6BC54F56161Fb3dFB7bDC2a8DBcB";
const usdtAddress = bsc.tokens.find((token) => token.symbol === "USDT")?.address ?? "";

afterEach(async () => {
  await Promise.all(served.splice(0).map(async (skeleton) => skeleton.close()));
  await machines.removeAll();
});

// The skeleton whose test wallet's ceiling lists the owner's address and lets a call reach the
// fake venue's router with at most one coin.
async function servedMachine(
  recipient: AccountRef = owner,
  dayCaps: readonly DayCapView[] = [],
): Promise<TestMachine> {
  if (selfHosted === undefined) {
    throw new Error("Expected the self-hosted composition.");
  }
  const machine = await machines.create(testNowMs);
  const skeleton = await serveSkeleton(machine, selfHosted);
  served.push(skeleton);
  const [wallet] = (await skeleton.parts.stores.install.read(live)).wallets;
  const calls = { contracts: [router], perTxNativeBase: 10n ** 18n, dayCaps };
  (skeleton.parts.ceilings as FakeCeilingEditor).put(wallet?.policyId ?? "", [recipient], calls);
  return machine;
}

describe("binference ceiling", () => {
  it("shows the default wallet's ceiling as custody holds it", slow, async () => {
    const machine = await servedMachine();

    const shown = await runOn(machine, ["ceiling"]);

    const lines = [
      en("ceiling.heading", {
        label: "Main",
        wallet: testWallet,
        readAt: english.dateTime(testNowMs),
      }),
      `  ${en("ceiling.chains", { chains: "fake:1" })}`,
      `  ${en("ceiling.venues", { count: 1, venues: "fake-swap" })}`,
      en("ceiling.capBase", { amount: "1000000000000000000" }),
      en("ceiling.recipients", { count: 1 }),
      `  ${en("ceiling.recipient", { address: "0x000000a1", chain: "fake:1" })}`,
      en("ceiling.dayCaps", { count: 0 }),
    ];
    expect([shown.code, shown.stderr]).toStrictEqual([0, ""]);
    expect(shown.stdout).toBe(`${lines.join("\n")}\n`);
  });

  it("shows the cap in the native coin of a chain this binference serves", slow, async () => {
    const machine = await servedMachine(accountRefSchema.parse(`eip155:56:${ownerAddress}`));

    const shown = await runOn(machine, ["ceiling"]);

    expect(shown.stdout).toContain(`${en("ceiling.cap", { amount: "1", symbol: "BNB" })}\n`);
    expect(shown.stdout).toContain(en("ceiling.chains", { chains: "BNB Smart Chain" }));
  });

  it("shows each 24-hour cap in its token and in dollars at the floor price", slow, async () => {
    const dayCaps = [
      {
        asset: assetRefSchema.parse(`${bsc.id}/slip44:714`),
        limit: 10n * 10n ** 18n,
        windowSeconds: 86_400,
        floorUsdMicros: 1_000_000_000n,
      },
      {
        asset: assetRefSchema.parse(`${bsc.id}/erc20:${usdtAddress}`),
        limit: 1_000n * 10n ** 18n,
        windowSeconds: 86_400,
        floorUsdMicros: 1_000_000_000n,
      },
      {
        asset: assetRefSchema.parse("fake:1/token:0x0000000a"),
        limit: 5n,
        windowSeconds: 3_600,
        floorUsdMicros: 0n,
      },
    ];
    const machine = await servedMachine(owner, dayCaps);

    const shown = await runOn(machine, ["ceiling"]);

    const day = { hours: 24, usd: "$1,000.00" };
    expect(shown.stdout).toContain(
      [
        en("ceiling.dayCaps", { count: 3 }),
        `  ${en("ceiling.dayCapSent", { ...day, amount: "10", symbol: "BNB" })}`,
        `  ${en("ceiling.dayCapApproved", { ...day, amount: "1,000", symbol: "USDT" })}`,
        `  ${en("ceiling.dayCapBase", { amount: "5", asset: "fake:1/token:0x0000000a", hours: 1, usd: "$0.00" })}`,
      ].join("\n"),
    );
  });

  it("prints the ceiling as JSON, and refuses a wallet it does not hold", slow, async () => {
    const machine = await servedMachine();

    const json = await runOn(machine, ["ceiling", "--json"]);
    expect(JSON.parse(json.stdout)).toStrictEqual({
      wallet: testWallet,
      chains: ["fake:1"],
      venues: ["fake-swap"],
      perTxNative: "1000000000000000000",
      recipients: [owner],
      dayCaps: [],
      readAt: testNowMs,
    });
    const other = "wal_0190f1c2-3a4b-7c5d-8e6f-0000000000c9";
    const refused = await runOn(machine, ["ceiling", "--wallet", other]);
    expect([refused.code, refused.stderr]).toStrictEqual([
      1,
      `${String(messages.en["error.wallet.not_found"])}\n`,
    ]);
  });
});

const pancakeswap = accountRefSchema.parse(
  `${bsc.id}:${bsc.contracts.find((item) => item.venue === "pancakeswap")?.address ?? ""}`,
);

// 10 BNB in 24 hours, $1,000 at the $100 floor.
const bnbDayCap = {
  asset: assetRefSchema.parse(`${bsc.id}/slip44:714`),
  limit: 10n * 10n ** 18n,
  windowSeconds: 86_400,
  floorUsdMicros: 1_000_000_000n,
};

interface ServedOnBsc {
  readonly machine: TestMachine;
  readonly ceilings: FakeCeilingEditor;
  readonly ceiling: string;
}

// The skeleton on BNB Smart Chain too, whose wallet's ceiling pays the owner on it, lets a call
// reach PancakeSwap with at most one BNB, and caps the BNB sent in 24 hours.
async function servedOnBsc(): Promise<ServedOnBsc> {
  if (selfHosted === undefined) {
    throw new Error("Expected the self-hosted composition.");
  }
  const machine = await machines.create(testNowMs);
  const skeleton = await serveSkeleton(machine, selfHosted, { chains: [bsc] });
  served.push(skeleton);
  const [wallet] = (await skeleton.parts.stores.install.read(live)).wallets;
  const ceilings = skeleton.parts.ceilings as FakeCeilingEditor;
  const ceiling = wallet?.policyId ?? "";
  const recipient = accountRefSchema.parse(`eip155:56:${ownerAddress}`);
  const calls = { contracts: [pancakeswap], perTxNativeBase: 10n ** 18n, dayCaps: [bnbDayCap] };
  ceilings.put(ceiling, [recipient], calls);
  return { machine, ceilings, ceiling };
}

async function dayCapOf(ceilings: FakeCeilingEditor, ceiling: string) {
  const read = await ceilings.read(ceiling, live);
  return read.ok ? read.value.dayCaps : undefined;
}

async function ceilingSet(
  machine: TestMachine,
  argv: readonly string[],
  answers: readonly ScriptedAnswer[] = [fakeOwnerKeyCode],
) {
  const prompter = createScriptedPrompter({ ownerKey: answers });
  const host = hostWith(machine, ["ceiling", "set", ...argv], { env: {}, parts: { prompter } });
  const code = await runCli(host);
  return { code, stdout: host.stdout(), stderr: host.stderr(), prompter };
}

async function capOf(ceilings: FakeCeilingEditor, ceiling: string): Promise<bigint | undefined> {
  const read = await ceilings.read(ceiling, live);
  return read.ok ? read.value.perTxNativeBase : undefined;
}

describe("binference ceiling set", () => {
  it(
    "changes the venues and the cap with the owner key, and prints the ceiling",
    slow,
    async () => {
      const { machine, ceilings, ceiling } = await servedOnBsc();

      const set = await ceilingSet(machine, ["--venues", "pancakeswap", "--per-tx", "0.5"]);

      expect([set.code, set.stderr]).toStrictEqual([0, ""]);
      expect(set.prompter.transcript.asked).toStrictEqual(["ownerKey"]);
      expect(set.stdout).toContain(`${en("ceiling.everyWallet")}\n${en("ceiling.changed")}\n`);
      expect(set.stdout).toContain(
        `  ${en("ceiling.venues", { count: 1, venues: "pancakeswap" })}\n`,
      );
      expect(set.stdout).toContain(`${en("ceiling.cap", { amount: "0.5", symbol: "BNB" })}\n`);
      expect(await capOf(ceilings, ceiling)).toBe(5n * 10n ** 17n);
    },
  );

  it("refuses nothing to change, a cap that is no amount, and no terminal", slow, async () => {
    const { machine, ceilings, ceiling } = await servedOnBsc();

    const nothing = await ceilingSet(machine, []);
    const tooFine = await ceilingSet(machine, ["--per-tx", "0.0000000000000000001"]);
    const scripted = await runOn(machine, ["ceiling", "set", "--per-tx", "0.5", "--yes"]);

    expect([nothing.code, nothing.stderr]).toStrictEqual([1, `${en("ceiling.nothingToSet")}\n`]);
    expect([tooFine.code, tooFine.stderr]).toStrictEqual([
      1,
      `${en("ceiling.badCap", { amount: "0.0000000000000000001" })}\n`,
    ]);
    expect(scripted.code).toBe(1);
    expect(scripted.stderr).toBe(`${en("ownerKey.needsTerminal", { command: "ceiling set" })}\n`);
    expect([nothing, tooFine].map((run) => run.prompter.transcript.asked)).toStrictEqual([[], []]);
    expect(await capOf(ceilings, ceiling)).toBe(10n ** 18n);
  });

  it(
    "changes nothing after three wrong owner keys, or for a venue the limits name",
    slow,
    async () => {
      const { machine, ceilings, ceiling } = await servedOnBsc();
      const wrong = ["a", "b", "c"].map((letter) => `bnok1${letter.repeat(25)}`);

      const refused = await ceilingSet(machine, ["--per-tx", "0.5"], wrong);
      const added = await ceilingSet(machine, ["--venues", "pancakeswap"]);
      const named = await runOn(machine, ["limit", "set", "limits.venues=fake-swap,pancakeswap"]);
      const removed = await ceilingSet(machine, ["--venues", "venus"]);

      expect([refused.code, added.code, named.code]).toStrictEqual([1, 0, 0]);
      expect(refused.stderr).toContain(en("ownerKey.wrongEnd"));
      expect([removed.code, removed.stderr]).toStrictEqual([
        2,
        `${String(messages.en["error.limit.venue_in_use"])}\n`,
      ]);
      expect(await capOf(ceilings, ceiling)).toBe(10n ** 18n);
    },
  );

  it(
    "resizes the 24-hour caps of every wallet with the owner key, and prints them",
    slow,
    async () => {
      const { machine, ceilings, ceiling } = await servedOnBsc();

      const set = await ceilingSet(machine, ["--day-cap-usd", "2000"]);

      expect([set.code, set.stderr]).toStrictEqual([0, ""]);
      expect(set.prompter.transcript.asked).toStrictEqual(["ownerKey"]);
      expect(set.stdout).toContain(
        `${en("ceiling.dayCapsEveryWallet")}\n${en("ceiling.changed")}\n`,
      );
      const day = { amount: "20", symbol: "BNB", hours: 24, usd: "$2,000.00" };
      expect(set.stdout).toContain(`  ${en("ceiling.dayCapSent", day)}\n`);
      expect(await dayCapOf(ceilings, ceiling)).toStrictEqual([
        { ...bnbDayCap, limit: 20n * 10n ** 18n, floorUsdMicros: 2_000_000_000n },
      ]);
    },
  );

  it("refuses caps with another change, and caps that are no amount above 0", slow, async () => {
    const { machine, ceilings, ceiling } = await servedOnBsc();

    const runs = [
      await ceilingSet(machine, ["--day-cap-usd", "2000", "--per-tx", "0.5"]),
      await ceilingSet(machine, ["--day-cap-usd", "0"]),
      await ceilingSet(machine, ["--day-cap-usd", "1.0000001"]),
    ];

    expect(runs.map((run) => [run.code, run.stderr])).toStrictEqual([
      [1, `${en("ceiling.dayCapsAlone")}\n`],
      [1, `${en("ceiling.badDayCap", { amount: "0" })}\n`],
      [1, `${en("ceiling.badDayCap", { amount: "1.0000001" })}\n`],
    ]);
    expect(runs.map((run) => run.prompter.transcript.asked)).toStrictEqual([[], [], []]);
    expect(await dayCapOf(ceilings, ceiling)).toStrictEqual([bnbDayCap]);
  });
});
