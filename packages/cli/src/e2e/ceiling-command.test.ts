import { type AccountRef, accountRefSchema } from "@binference/chain";
import { type FakeCeilingEditor, testNowMs, testWallet } from "@binference/engine/testing";
import { createFormatter, messages } from "@binference/i18n";
import { afterEach, describe, expect, it } from "vitest";
import { skeletonCompositions } from "../compose/test-skeleton.js";
import { type ServedSkeleton, serveSkeleton } from "./skeleton-machine.js";
import { createTestMachines, runOn, type TestMachine } from "./test-host.js";

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

afterEach(async () => {
  await Promise.all(served.splice(0).map(async (skeleton) => skeleton.close()));
  await machines.removeAll();
});

// The skeleton whose test wallet's ceiling lists the owner's address and lets a call reach the
// fake venue's router with at most one coin.
async function servedMachine(recipient: AccountRef = owner): Promise<TestMachine> {
  if (selfHosted === undefined) {
    throw new Error("Expected the self-hosted composition.");
  }
  const machine = await machines.create(testNowMs);
  const skeleton = await serveSkeleton(machine, selfHosted);
  served.push(skeleton);
  const [wallet] = (await skeleton.parts.stores.install.read(live)).wallets;
  const calls = { contracts: [router], perTxNativeBase: 10n ** 18n };
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

  it("prints the ceiling as JSON, and refuses a wallet it does not hold", slow, async () => {
    const machine = await servedMachine();

    const json = await runOn(machine, ["ceiling", "--json"]);
    expect(JSON.parse(json.stdout)).toStrictEqual({
      wallet: testWallet,
      chains: ["fake:1"],
      venues: ["fake-swap"],
      perTxNative: "1000000000000000000",
      recipients: [owner],
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
