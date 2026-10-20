import { accountRefSchema, type LaunchOption } from "@binference/chain";
import {
  createFakeLauncher,
  createFakeLaunchpad,
  createFakeSigner,
} from "@binference/chain/testing";
import { createManualClock } from "@binference/core/testing";
import type { LaunchTokenRequest } from "@binference/protocol";
import { describe, expect, it } from "vitest";
import { fixtureId } from "../contracts/store-fixtures.js";
import { createFakeWalletFacts } from "../fakes/fake-wallet-facts.js";
import { createMemoryEngineStores } from "../fakes/memory-engine-stores.js";
import { testWalletRecord } from "../install/test-wallet-record.js";
import {
  testAgent,
  testAgentDraft,
  testCoin,
  testNowMs,
  testWallet,
} from "../intents/test-intents.js";
import { testAccount, testChains, testFacts } from "../operations/test-engine.js";
import { createLaunchHost } from "../venues/launch-host.js";
import { resolveLaunch } from "./resolve-launch.js";

// A launchpad that pays its creator fee recipient only on a claim binference never makes, so the
// recipient must be outside the install (decision 0277).
const pad = "fake-curve";
const signal = AbortSignal.timeout(5_000);
const settings: readonly LaunchOption[] = [
  { name: "creatorFeeRecipient", type: "account", isOutsideOnly: true },
];
const launchWallet = fixtureId("wal", 281);
const otherAgent = fixtureId("agt", 282);
const wallets = [
  testWalletRecord({ id: testWallet, agentId: testAgent, label: "main", createdAtMs: testNowMs }),
  testWalletRecord({
    id: launchWallet,
    agentId: testAgent,
    label: "launches",
    createdAtMs: testNowMs,
    role: "launch",
  }),
  testWalletRecord({
    id: fixtureId("wal", 283),
    agentId: otherAgent,
    label: "other",
    createdAtMs: testNowMs,
  }),
];

async function resolvedWith(recipient: string) {
  const chains = testChains([pad]);
  const launcher = createFakeLauncher({ launchOptions: settings });
  const venues = [createFakeLaunchpad({ onCurve: [], launcher })];
  const stores = createMemoryEngineStores();
  await stores.agents.create(testAgentDraft({ mode: "live" }), { signal });
  for (const wallet of wallets) {
    stores.install.addWallet(wallet);
  }
  const launchAccount = accountRefSchema.parse(`fake:1:${wallets[1]?.address ?? ""}`);
  const found = await stores.agents.get(testAgent, { signal });
  if (found === undefined) {
    throw new Error("The test agent is missing.");
  }
  const request: LaunchTokenRequest = {
    kind: "launchToken",
    agent: testAgent,
    reason: "Launch it",
    venue: pad,
    name: "Moon Cat",
    symbol: "MCAT",
    image: "upl_moon",
    pairWith: testCoin,
    venueOptions: { creatorFeeRecipient: recipient },
  };
  return resolveLaunch(
    {
      chains,
      wallets: createFakeWalletFacts(new Map([[testAgent, [testWallet, launchWallet]]]), testFacts),
      install: stores.install,
      custody: createFakeSigner(
        new Map([
          [testWallet, testAccount],
          [launchWallet, launchAccount],
        ]),
      ),
      launch: {
        host: createLaunchHost({
          venues,
          chains,
          clock: createManualClock(testNowMs),
          callTimeoutMs: 1_000,
        }),
      },
    },
    { request, settings: found, isPaper: false, signal },
  );
}

describe("a launch setting that must be outside the install", () => {
  it.each(wallets.map((wallet) => [wallet.label, wallet.address] as const))(
    "refuses the %s wallet before anything is stored",
    async (_label, address) => {
      await expect(resolvedWith(address)).resolves.toStrictEqual({
        ok: false,
        error: "intent.own_wallet_recipient",
      });
    },
  );

  it("takes an address outside the install", async () => {
    await expect(resolvedWith("0x000000aa")).resolves.toMatchObject({ ok: true });
  });
});
