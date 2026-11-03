import { type AccountRef, accountRefSchema, type WalletRole } from "@binference/chain";
import { bsc, bscVenueCalls } from "@binference/chains";
import { type Http, type Id, idSchema, ok, type Result } from "@binference/core";
import { createManualClock, createSeededRandom } from "@binference/core/testing";
import {
  createPrivyApi,
  type HeldCaps,
  isPrivyId,
  type PrivyWallet,
  readCeiling,
} from "@binference/custody-privy";
import {
  createFakePrivy,
  testAddresses,
  testCapPlan,
  testCeilingRequest,
  testLaunchCeilingRequest,
} from "@binference/custody-privy/testing";
import type { CustodyRecord } from "@binference/engine/install";
import { walletMakerContract } from "@binference/engine/testing";
import { createP256KeyPair, formatOwnerKeyCode } from "@binference/signer";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { currentConfigVersion } from "../config/migrations/config-migrations.js";
import { configSchema } from "../config/schema/config.schema.js";
import type { CeilingDraft } from "../init/ceiling-request.js";
import { selfHostedChains } from "./open-engine-parts.js";
import { createPrivyWalletMaker } from "./privy-wallet-maker.js";
import { selfHostedCeilingAddresses } from "./self-hosted-destinations.js";
import { ceilingChainsOf } from "./wallet-ceilings.js";

const live = { signal: new AbortController().signal };
const accountOf = (address: string): AccountRef => accountRefSchema.parse(`eip155:56:${address}`);
const recipients = [accountOf(testAddresses.rescue), accountOf(testAddresses.saved)] as const;
const walletId = (n: number): Id<"wal"> =>
  idSchema("wal").parse(`wal_0190f1c2-3a4b-7c5d-8e6f-${String(n).padStart(12, "0")}`);

interface RuleJson {
  readonly name: string;
  readonly conditions: readonly { readonly field: string; readonly value: string | string[] }[];
}

function listedIn(rule: RuleJson | undefined): readonly string[] {
  const value = rule?.conditions.find((condition) => condition.field === "to")?.value ?? [];
  return typeof value === "string" ? [value] : value;
}

// The test ceiling's chains as the composition root plans them, before Privy holds their caps,
// and a launch wallet's, with the launch rules.
const draft = {
  chains: testCeilingRequest().chains.map(({ caps: _caps, ...plan }) => plan),
  capPlans: [testCapPlan],
};
const launchDraft = {
  chains: testLaunchCeilingRequest().chains.map(({ caps: _caps, ...plan }) => plan),
  capPlans: [testCapPlan],
};

// A bridge wallet's ceiling as the CLI plans it, for an install that runs Relay beside KyberSwap.
const bridgePlans = {
  chains: selfHostedChains(),
  config: configSchema.parse({
    version: currentConfigVersion,
    telegram: { botToken: { fromEnv: "TEST_BOT_TOKEN" } },
  }),
  venues: [{ id: "relay", contracts: [bscVenueCalls["relay"]].flatMap((item) => item ?? []) }],
};

const roleDrafts: Readonly<
  Record<
    WalletRole,
    (wallet: {
      readonly venues: readonly string[];
    }) => Result<Pick<CeilingDraft, "chains" | "capPlans">, "venue_not_run">
  >
> = {
  launch: () => ok(launchDraft),
  bridge: (wallet) => ceilingChainsOf(bridgePlans, { ...wallet, role: "bridge" }),
};

interface Counted {
  readonly http: Http;
  readonly made: () => number;
  readonly aggregations: () => number;
  /** The caps the ceilings made so far name, as the install store would mirror them. */
  readonly heldCaps: () => Promise<readonly HeldCaps[]>;
}

// Privy's API as the fake serves it, counting each wallet and aggregation it is asked to make.
function countingWallets(http: Http): Counted {
  const count = { made: 0, aggregations: 0, caps: [] as readonly HeldCaps[] };
  const counting: Http = {
    request: async (request) => {
      const path = new URL(request.url).pathname;
      count.made += request.method === "POST" && path === "/v1/wallets" ? 1 : 0;
      count.aggregations += request.method === "POST" && path === "/v1/aggregations" ? 1 : 0;
      const answer = await http.request(request);
      if (request.method === "POST" && path === "/v1/policies" && count.caps.length === 0) {
        const policy = z.object({ rules: z.array(z.json()) }).parse(JSON.parse(answer.body));
        count.caps = readCeiling(policy.rules)?.caps ?? [];
      }
      return answer;
    },
  };
  return {
    http: counting,
    made: () => count.made,
    aggregations: () => count.aggregations,
    heldCaps: async () => Promise.resolve(count.caps),
  };
}

async function subject() {
  const clock = createManualClock(1_790_000_000_000);
  const privy = createFakePrivy({ clock, random: createSeededRandom(9) });
  const counted = countingWallets(privy.http);
  const api = createPrivyApi({
    http: counted.http,
    clock,
    appId: privy.appId,
    appSecret: privy.appSecret,
  });
  const owner = createP256KeyPair();
  const agent = createP256KeyPair();
  const ownerQuorum = await api.createKeyQuorum(
    { publicKey: owner.publicKey, displayName: "o" },
    live,
  );
  const agentQuorum = await api.createKeyQuorum(
    { publicKey: agent.publicKey, displayName: "a" },
    live,
  );
  const custody: CustodyRecord = {
    provider: "privy",
    appId: privy.appId,
    ownerQuorumId: ownerQuorum.id,
    ownerKeyPublic: owner.publicKey,
    agentQuorumId: agentQuorum.id,
    agentKeyPublic: agent.publicKey,
    attachedAtMs: clock.now(),
  };
  const signedFor = new Map<string, PrivyWallet>();
  const maker = createPrivyWalletMaker({
    api,
    clock,
    custody: async () => Promise.resolve(custody),
    ceilingChains: (wallet: { readonly venues: readonly string[]; readonly role?: WalletRole }) =>
      wallet.role === undefined ? ok(draft) : roleDrafts[wallet.role](wallet),
    heldCaps: counted.heldCaps,
    onMade: (wallet, made) => signedFor.set(wallet, made),
    addresses: selfHostedCeilingAddresses([bsc]),
  });
  const next = { n: 0 };
  return {
    maker,
    ownerKey: formatOwnerKeyCode(owner),
    otherKey: formatOwnerKeyCode(createP256KeyPair()),
    venues: ["kyberswap"],
    recipients,
    nextWallet: () => walletId((next.n += 1)),
    // The accounts the native send rule lists, as Privy holds the new wallet's policy.
    recipientsOf: async (made: { readonly record: { readonly policyId: string } }) => {
      const { policyId } = made.record;
      const held = isPrivyId(policyId) ? await api.policy(policyId, live) : undefined;
      const rules = (held?.ok === true ? held.value.rules : []) as unknown as readonly RuleJson[];
      const sends = rules.find((rule) => rule.name === "Native sends, chain 56");
      return listedIn(sends).map(accountOf).toSorted();
    },
    isLaunchCeiling: async (made: { readonly record: { readonly policyId: string } }) => {
      const { policyId } = made.record;
      const held = isPrivyId(policyId) ? await api.policy(policyId, live) : undefined;
      return held?.ok === true && readCeiling(held.value.rules)?.isLaunch === true;
    },
    // The rules Privy holds for a made wallet's ceiling.
    rulesOf: async (made: Result<{ readonly record: { readonly policyId: string } }, string>) => {
      const policyId = made.ok ? made.value.record.policyId : "";
      const held = isPrivyId(policyId) ? await api.policy(policyId, live) : undefined;
      return held?.ok === true ? held.value.rules : [];
    },
    made: counted.made,
    aggregations: counted.aggregations,
    signedFor,
  };
}

describe("the Privy wallet maker", () => {
  it("makes a bridge wallet whose stored ceiling allows Relay's deposits, whatever its venues", async () => {
    const made = await subject();
    const { ownerKey, venues } = made;
    const request = {
      ownerKey,
      venues,
      recipients,
      role: "bridge",
      wallet: made.nextWallet(),
    } as const;

    const answer = await made.maker.make(request, live);

    const rules = await made.rulesOf(answer);
    expect(readCeiling(rules)?.functions).toStrictEqual(["depositErc20"]);
  });

  it.each(walletMakerContract({ create: subject }))(
    "follows the wallet maker contract: $name",
    async ({ run }) => {
      await expect(run()).resolves.toBeUndefined();
    },
  );

  it("signs for each wallet it made under the engine's id", async () => {
    const made = await subject();
    const wallet = made.nextWallet();

    const answer = await made.maker.make(
      { wallet, ownerKey: made.ownerKey, venues: made.venues, recipients },
      live,
    );

    expect(answer.ok).toBe(true);
    expect(made.signedFor.get(wallet)?.chains).toStrictEqual(["eip155:56"]);
  });

  it("makes the caps' aggregations once, and names them in every later ceiling", async () => {
    const made = await subject();
    const request = { ownerKey: made.ownerKey, venues: made.venues, recipients };

    const first = await made.maker.make({ ...request, wallet: made.nextWallet() }, live);
    const second = await made.maker.make({ ...request, wallet: made.nextWallet() }, live);

    expect([first.ok, second.ok]).toStrictEqual([true, true]);
    expect(made.aggregations()).toBe(1 + testCapPlan.approvals.length);
  });

  it("refuses every owner key before the install holds custody", async () => {
    const made = await subject();
    const bare = createPrivyWalletMaker({
      api: createPrivyApi({
        http: createFakePrivy({ clock: createManualClock(1), random: createSeededRandom(1) }).http,
        clock: createManualClock(1),
        appId: "app",
        appSecret: made.ownerKey,
      }),
      clock: createManualClock(1),
      custody: async () => Promise.resolve(undefined),
      ceilingChains: () => ok(draft),
      heldCaps: async () => Promise.resolve([]),
      onMade: () => undefined,
      addresses: selfHostedCeilingAddresses([bsc]),
    });
    const request = {
      wallet: made.nextWallet(),
      ownerKey: made.ownerKey,
      venues: [],
      recipients,
    };

    expect(await bare.make(request, live)).toStrictEqual({ ok: false, error: "bad_owner_key" });
  });
});
