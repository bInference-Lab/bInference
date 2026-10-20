import {
  accountRefSchema,
  assetRefSchema,
  type LaunchOption,
  type LaunchWordLimits,
} from "@binference/chain";
import {
  createFakeLauncher,
  createFakeLaunchpad,
  createFakeSigner,
} from "@binference/chain/testing";
import { createManualClock } from "@binference/core/testing";
import type { LaunchTokenRequest } from "@binference/protocol";
import { describe, expect, it } from "vitest";
import type { AgentSettings } from "../agents/agent-record.js";
import { fixtureId } from "../contracts/store-fixtures.js";
import { createFakeWalletFacts } from "../fakes/fake-wallet-facts.js";
import { createMemoryEngineStores } from "../fakes/memory-engine-stores.js";
import { testWalletRecord } from "../install/test-wallet-record.js";
import {
  testAgent,
  testAgentDraft,
  testCoin,
  testNowMs,
  testToken,
  testWallet,
} from "../intents/test-intents.js";
import { testAccount, testChains, testFacts } from "../operations/test-engine.js";
import { createLaunchHost } from "../venues/launch-host.js";
import { type ResolveLaunchOptions, resolveLaunch } from "./resolve-launch.js";

const pad = "fake-curve";
const launchWallet = fixtureId("wal", 271);
const launchAccount = accountRefSchema.parse("fake:1:0x000000d9");
const settings: readonly LaunchOption[] = [{ name: "taxBps", type: "bps", max: 1000, default: 0 }];
const signal = AbortSignal.timeout(5_000);

const launch: LaunchTokenRequest = {
  kind: "launchToken",
  agent: testAgent,
  reason: "Launch it",
  venue: pad,
  name: "Moon Cat",
  symbol: "MCAT",
  image: "upl_moon",
  pairWith: testCoin,
  venueOptions: { taxBps: 100 },
};

// The resolve's ports over the fake chain: a launchpad that launches, the test agent's two
// wallets, and, when asked, the second one stored as its launch wallet.
async function optionsOf(agent: {
  readonly hasLaunchWallet: boolean;
  readonly wordLimits?: LaunchWordLimits;
}) {
  const chains = testChains([pad]);
  const clock = createManualClock(testNowMs);
  const limits = agent.wordLimits === undefined ? {} : { wordLimits: agent.wordLimits };
  const launcher = createFakeLauncher({ launchOptions: settings, ...limits });
  const venues = [createFakeLaunchpad({ onCurve: [], launcher })];
  const stores = createMemoryEngineStores();
  await stores.agents.create(testAgentDraft({ mode: "live" }), { signal });
  if (agent.hasLaunchWallet) {
    const record = {
      id: launchWallet,
      agentId: testAgent,
      label: "launches",
      createdAtMs: testNowMs,
    };
    stores.install.addWallet(testWalletRecord({ ...record, role: "launch" }));
  }
  const options: ResolveLaunchOptions = {
    chains,
    wallets: createFakeWalletFacts(new Map([[testAgent, [testWallet, launchWallet]]]), testFacts),
    install: stores.install,
    custody: createFakeSigner(
      new Map([
        [testWallet, testAccount],
        [launchWallet, launchAccount],
      ]),
    ),
    launch: { host: createLaunchHost({ venues, chains, clock, callTimeoutMs: 1_000 }) },
  };
  const found = await stores.agents.get(testAgent, { signal });
  return { options, settings: settingsOf(found) };
}

function settingsOf(found: AgentSettings | undefined): AgentSettings {
  if (found === undefined) {
    throw new Error("The test agent is missing.");
  }
  return found;
}

async function resolved(
  request: LaunchTokenRequest,
  options: {
    readonly isPaper?: boolean;
    readonly hasLaunchWallet?: boolean;
    readonly wordLimits?: LaunchWordLimits;
  } = {},
) {
  const limits = options.wordLimits === undefined ? {} : { wordLimits: options.wordLimits };
  const parts = await optionsOf({ hasLaunchWallet: options.hasLaunchWallet ?? true, ...limits });
  const isPaper = options.isPaper ?? false;
  return resolveLaunch(parts.options, { request, settings: parts.settings, isPaper, signal });
}

describe("a token launch as the engine resolves it", () => {
  it("runs a live launch from the agent's launch wallet, its settings filled", async () => {
    await expect(resolved(launch)).resolves.toMatchObject({
      ok: true,
      value: {
        wallet: launchWallet,
        account: launchAccount,
        isLaunchWallet: true,
        launchSettings: [{ name: "taxBps", type: "bps", value: 100 }],
      },
    });
  });

  it.each<
    [string, LaunchTokenRequest, { readonly isPaper?: boolean; readonly hasLaunchWallet?: boolean }]
  >([
    ["a paper launch", launch, { isPaper: true }],
    ["a launch that names another wallet", { ...launch, wallet: testWallet }, {}],
    ["an agent with no launch wallet", launch, { hasLaunchWallet: false }],
  ])("holds %s on another wallet, not as a launch wallet's", async (_case, request, options) => {
    await expect(resolved(request, options)).resolves.toMatchObject({
      ok: true,
      value: { wallet: testWallet, isLaunchWallet: false },
    });
  });

  it("takes a description of 1,000 characters outside the basic plane, as the card shows them", async () => {
    // Each character is one code point and two UTF-16 units.
    const description = String.fromCodePoint(0x1_d400).repeat(1_000);
    await expect(resolved({ ...launch, description })).resolves.toMatchObject({ ok: true });
  });

  it.each<[string, LaunchTokenRequest, string]>([
    ["a venue that launches nothing", { ...launch, venue: "fake-swap" }, "quote.no_route"],
    [
      "settings the launchpad does not take",
      { ...launch, venueOptions: { tax: 1 } },
      "protocol.bad_args",
    ],
    [
      "a wallet that is not the agent's",
      { ...launch, wallet: fixtureId("wal", 9) },
      "wallet.not_found",
    ],
    [
      "a first buy in another asset than the pair",
      { ...launch, firstBuy: { asset: testToken, base: 10n } },
      "protocol.bad_args",
    ],
    [
      "a first buy on another chain",
      { ...launch, firstBuy: { asset: assetRefSchema.parse("fake:2/slip44:1"), base: 10n } },
      "protocol.bad_args",
    ],
    [
      "a description longer than the card shows",
      { ...launch, description: "a".repeat(1_001) },
      "protocol.bad_args",
    ],
    [
      "a link longer than the card shows",
      { ...launch, links: { website: `https://moon.example/${"a".repeat(180)}` } },
      "protocol.bad_args",
    ],
  ])("refuses %s before anything is stored", async (_case, request, error) => {
    await expect(resolved(request)).resolves.toStrictEqual({ ok: false, error });
  });

  describe("on a launchpad that writes the words on chain", () => {
    const wordLimits = { nameBytes: 64, symbolBytes: 16, descriptionBytes: 2_048, linkBytes: 256 };

    it("takes words that fit the bytes its create call takes", async () => {
      const description = "€".repeat(682);
      await expect(resolved({ ...launch, description }, { wordLimits })).resolves.toMatchObject({
        ok: true,
      });
    });

    it.each<[string, LaunchTokenRequest]>([
      // 683 characters of 3 bytes each: within the card's 1,000 characters, over 2,048 bytes.
      ["a description over its bytes", { ...launch, description: "€".repeat(683) }],
      ["a symbol over its bytes", { ...launch, symbol: "€".repeat(6) }],
      ["a name over its bytes", { ...launch, name: "€".repeat(22) }],
      [
        "a link over its bytes",
        { ...launch, links: { telegram: `https://t.me/${"€".repeat(82)}` } },
      ],
    ])("refuses %s before anything is stored", async (_case, request) => {
      await expect(resolved(request, { wordLimits })).resolves.toStrictEqual({
        ok: false,
        error: "protocol.bad_args",
      });
    });
  });
});
