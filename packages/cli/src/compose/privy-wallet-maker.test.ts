import { type AccountRef, accountRefSchema } from "@binference/chain";
import { type Http, type Id, idSchema } from "@binference/core";
import { createManualClock, createSeededRandom } from "@binference/core/testing";
import { createPrivyApi, isPrivyId, type PrivyWallet } from "@binference/custody-privy";
import {
  createFakePrivy,
  testAddresses,
  testCeilingRequest,
} from "@binference/custody-privy/testing";
import type { CustodyRecord } from "@binference/engine/install";
import { walletMakerContract } from "@binference/engine/testing";
import { createP256KeyPair, formatOwnerKeyCode } from "@binference/signer";
import { describe, expect, it } from "vitest";
import { createPrivyWalletMaker } from "./privy-wallet-maker.js";

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

// Privy's API as the fake serves it, counting each wallet it is asked to make.
function countingWallets(http: Http): { readonly http: Http; readonly made: () => number } {
  const count = { made: 0 };
  const counting: Http = {
    request: async (request) => {
      if (request.method === "POST" && new URL(request.url).pathname === "/v1/wallets") {
        count.made += 1;
      }
      return http.request(request);
    },
  };
  return { http: counting, made: () => count.made };
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
    ceilingChains: () => testCeilingRequest().chains,
    onMade: (wallet, made) => signedFor.set(wallet, made),
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
    made: counted.made,
    signedFor,
  };
}

describe("the Privy wallet maker", () => {
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
      ceilingChains: () => testCeilingRequest().chains,
      onMade: () => undefined,
    });
    const request = { wallet: made.nextWallet(), ownerKey: made.ownerKey, venues: [], recipients };

    expect(await bare.make(request, live)).toStrictEqual({ ok: false, error: "bad_owner_key" });
  });
});
