import { chainRefSchema } from "@binference/chain";
import { bsc } from "@binference/chains";
import {
  createManualClock,
  createScriptedHttp,
  createSeededRandom,
} from "@binference/core/testing";
import {
  buildCeiling,
  createPrivyApi,
  type PrivyApi,
  type PrivyId,
} from "@binference/custody-privy";
import {
  createFakePrivy,
  testCapPlan,
  testCeilingRequest,
} from "@binference/custody-privy/testing";
import { createP256KeyPair, formatOwnerKeyCode, type P256KeyPair } from "@binference/signer";
import { describe, expect, it } from "vitest";
import { currentConfigVersion } from "../config/migrations/config-migrations.js";
import { configSchema } from "../config/schema/config.schema.js";
import { coreVenues } from "../init/ceiling-request.js";
import { selfHostedCeilingVenues } from "./ceiling-venues.js";
import { composeChainReads } from "./chain-reads.js";
import { selfHostedChains } from "./open-engine-parts.js";
import { createPrivyCeilingEditor } from "./privy-ceiling-editor.js";
import { selfHostedBridging } from "./self-hosted-bridging.js";
import { selfHostedCeilingAddresses } from "./self-hosted-destinations.js";
import { ceilingCallsOn, ceilingChainsOf } from "./wallet-ceilings.js";

const bscRef = chainRefSchema.parse(bsc.id);
const bnb = 10n ** 18n;
const config = configSchema.parse({
  version: currentConfigVersion,
  telegram: { botToken: { fromEnv: "TEST_BOT_TOKEN" } },
});

// The venues a running engine plans ceilings from, over BSC reads of a node the test never asks:
// KyberSwap and Flap stand for the venues it quotes on, as `readVenues` gives them.
function runningVenues() {
  const http = createScriptedHttp([]);
  const clock = createManualClock(0);
  const reads = composeChainReads({
    chains: selfHostedChains(),
    config: {
      enabled: [bscRef],
      rpc: { [bscRef]: { urls: ["https://node.example.org/"] } },
      relays: {},
      maxFeePerGasGwei: { [bscRef]: "1" },
    },
    http,
    clock,
  });
  const quoting = coreVenues(http, config.venues).filter(({ id }) =>
    ["kyberswap", "flap"].includes(id),
  );
  const { bridges } = selfHostedBridging({ http, clock, reads }).executor;
  return { venues: selfHostedCeilingVenues({ venues: quoting, reads, bridges }), http };
}

const names = (calls: readonly { readonly abi: { readonly name: string } }[]) =>
  calls.map((call) => call.abi.name);

// The value of a plan the install could make.
function planned<T>(result: { readonly ok: true; readonly value: T } | { readonly ok: false }): T {
  if (!result.ok) {
    throw new Error("Expected the install to plan it.");
  }
  return result.value;
}

describe("the venues a running engine plans ceilings from", () => {
  it("runs the staking venues and the bridges beside the venues it quotes on, each once", () => {
    const { venues, http } = runningVenues();

    expect(venues.map(({ id }) => id)).toStrictEqual([
      "kyberswap",
      "flap",
      "stakehub",
      "lista",
      "across",
      "relay",
    ]);
    expect(http.requests()).toStrictEqual([]);
  });

  it("keeps StakeHub's and Lista's calls, the stake's own cap and Across's deposits in a rewrite", () => {
    const plans = { chains: selfHostedChains(), venues: runningVenues().venues };
    const named = ["kyberswap", "stakehub", "lista", "across"];

    const plan = planned(ceilingCallsOn(plans, bscRef, { venues: named, perTxNativeBase: bnb }));

    expect(names(plan.calls)).toStrictEqual(
      expect.arrayContaining([
        "delegate",
        "undelegate",
        "claim",
        "deposit",
        "requestWithdraw",
        "claimWithdrawByUUID",
      ]),
    );
    expect(plan.calls.find((call) => call.abi.name === "delegate")?.maxValueBase).toBe(100n * bnb);
    expect(plan.bridges?.length).toBeGreaterThan(0);
  });

  it("gives a new wallet StakeHub's and Lista's calls when its agent names them", () => {
    const plans = { chains: selfHostedChains(), config, venues: runningVenues().venues };

    const drafted = planned(ceilingChainsOf(plans, { venues: ["kyberswap", "stakehub", "lista"] }));

    const [chain] = drafted.chains.map((item) => names(item.calls));
    expect(chain).toStrictEqual(
      expect.arrayContaining(["delegate", "undelegate", "claim", "deposit"]),
    );
  });

  it("refuses a change that names a venue the install does not run", () => {
    const plans = { chains: selfHostedChains(), venues: runningVenues().venues };

    const plan = ceilingCallsOn(plans, bscRef, {
      venues: ["kyberswap", "pancakeswap"],
      perTxNativeBase: bnb,
    });

    expect(plan).toStrictEqual({ ok: false, error: "venue_not_run" });
  });
});

const live = { signal: new AbortController().signal };
const stakeVenues = ["kyberswap", "stakehub", "lista"];

interface RuleJson {
  readonly name: string;
  readonly conditions: readonly { readonly field: string; readonly value: unknown }[];
}

// The most native coin each rule of the policy lets one call carry, by the rule's name.
async function valueCaps(api: PrivyApi, policy: PrivyId): Promise<ReadonlyMap<string, unknown>> {
  const held = await api.policy(policy, live);
  const rules = (held.ok ? held.value.rules : []) as unknown as readonly RuleJson[];
  return new Map(
    rules.map((rule) => [
      rule.name,
      rule.conditions.find((condition) => condition.field === "value")?.value,
    ]),
  );
}

// A policy on the fake Privy as a ceiling held it before decision 0325: the venues' calls, each
// under the chain's 1 BNB, owned by the owner key's quorum.
async function oldCeiling(api: PrivyApi, owner: P256KeyPair): Promise<PrivyId> {
  const plans = { chains: selfHostedChains(), venues: runningVenues().venues };
  const current = planned(
    ceilingCallsOn(plans, bscRef, { venues: stakeVenues, perTxNativeBase: bnb }),
  );
  const request = testCeilingRequest();
  const [chain] = request.chains;
  const calls = current.calls.map(({ maxValueBase: _cap, ...call }) => call);
  const built = buildCeiling({
    ...request,
    chains: chain === undefined ? [] : [{ ...current, calls, caps: chain.caps }],
  });
  if (!built.ok) {
    throw new Error("Expected the old ceiling.");
  }
  const quorum = await api.createKeyQuorum(
    { publicKey: owner.publicKey, displayName: "owner" },
    live,
  );
  return (await api.createPolicy({ ceiling: built.value, owner: quorum.id }, live)).id;
}

// The Privy API and the ceiling editor the engine composes, on a fake Privy.
function privyEditor(owner: P256KeyPair) {
  const clock = createManualClock(1_790_000_000_000);
  const privy = createFakePrivy({ clock, random: createSeededRandom(7) });
  const { appId, appSecret } = privy;
  const api = createPrivyApi({ http: privy.http, clock, appId, appSecret });
  const plans = { chains: selfHostedChains(), venues: runningVenues().venues };
  const editor = createPrivyCeilingEditor({
    api,
    clock,
    ownerKeyPublic: async () => Promise.resolve(owner.publicKey),
    callsOn: (chain, calls) => ceilingCallsOn(plans, chain, calls),
    capPlanOn: () => testCapPlan,
    capAssetsOn: () => undefined,
    heldCaps: async () => Promise.resolve([]),
    addresses: selfHostedCeilingAddresses([bsc]),
  });
  return { api, editor };
}

describe("a ceiling written again with its venues (decisions 0325 and 0332)", () => {
  it("gains StakeHub's and Lista's 100 BNB stake rules where it held 1 BNB", async () => {
    const owner = createP256KeyPair();
    const { api, editor } = privyEditor(owner);
    const ceiling = await oldCeiling(api, owner);
    const before = await valueCaps(api, ceiling);

    const set = await editor.setCalls(
      {
        ownerKey: formatOwnerKeyCode(owner),
        ceilings: [{ ceiling, venues: stakeVenues, perTxNativeBase: bnb }],
      },
      live,
    );

    const after = await valueCaps(api, ceiling);
    const [one, hundred] = [bnb, 100n * bnb].map((cap) => `0x${cap.toString(16)}`);
    expect(set.ok).toBe(true);
    expect([
      before.get("Call delegate, chain 56"),
      before.get("Call deposit, chain 56"),
      before.has("Call delegate, own cap, chain 56"),
      before.has("Call deposit, own cap, chain 56"),
    ]).toStrictEqual([one, one, false, false]);
    expect([
      after.get("Call delegate, own cap, chain 56"),
      after.get("Call deposit, own cap, chain 56"),
      after.has("Call delegate, chain 56"),
      after.has("Call deposit, chain 56"),
      after.get("Call undelegate, chain 56"),
      after.get("Call requestWithdraw, chain 56"),
    ]).toStrictEqual([hundred, hundred, false, false, one, one]);
  });
});
