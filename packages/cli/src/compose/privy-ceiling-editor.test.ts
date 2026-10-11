import { type AccountRef, accountRefSchema, assetRefSchema } from "@binference/chain";
import { createManualClock, createSeededRandom } from "@binference/core/testing";
import {
  buildCeiling,
  type CeilingChainPlan,
  type ChainCapPlan,
  createPrivyApi,
} from "@binference/custody-privy";
import {
  createFakePrivy,
  testAddresses,
  testCalls,
  testCapPlan,
  testCeilingRequest,
  testChain,
} from "@binference/custody-privy/testing";
import { ceilingEditorContract } from "@binference/engine/testing";
import { createP256KeyPair, formatOwnerKeyCode } from "@binference/signer";
import { describe, expect, it } from "vitest";
import { createPrivyCeilingEditor } from "./privy-ceiling-editor.js";

const live = { signal: new AbortController().signal };
const { rescue, saved, unsaved, router } = testAddresses;
const accountOf = (address: string): AccountRef => accountRefSchema.parse(`eip155:56:${address}`);
const accounts = [accountOf(rescue), accountOf(saved), accountOf(unsaved)] as const;

// The test venue "swap" calls the router on the test chain; no other venue has a contract.
function callsOn(
  chain: unknown,
  calls: { readonly venues: readonly string[]; readonly perTxNativeBase: bigint },
): CeilingChainPlan {
  const swap = calls.venues.includes("swap");
  return {
    chain: testChain,
    calls: swap ? testCalls : [],
    spenders: swap ? [router] : [],
    perTxNativeCapBase: calls.perTxNativeBase,
  };
}

const nativeAsset = assetRefSchema.parse("eip155:56/slip44:714");
const tokenAsset = assetRefSchema.parse(`eip155:56/erc20:${testAddresses.token}`);

// BNB at a $100 floor; the test token, of no decimals, at $1.
// The test plan, or at a size asked: BNB at $100 and the test token at $1, as the floors below.
function capPlanOn(chain: unknown, dayUsdMicros?: bigint): ChainCapPlan {
  if (dayUsdMicros === undefined) {
    return testCapPlan;
  }
  const [token] = testCapPlan.approvals;
  return {
    ...testCapPlan,
    nativeLimitBase: (dayUsdMicros * 10n ** 18n) / 100_000_000n,
    approvals: token === undefined ? [] : [{ ...token, limitBase: dayUsdMicros / 1_000_000n }],
  };
}

const capsOptions = {
  capPlanOn,
  capAssetsOn: () => ({
    native: { asset: nativeAsset, decimals: 18, floorUsd: 100_000_000n },
    tokens: [{ asset: tokenAsset, token: testAddresses.token, decimals: 0, floorUsd: 1_000_000n }],
  }),
  heldCaps: async () => Promise.resolve([]),
};

interface RuleJson {
  readonly name: string;
  readonly conditions: readonly { readonly field: string; readonly value: string | string[] }[];
}

function listedIn(rule: RuleJson | undefined): readonly string[] {
  const value = rule?.conditions.find((condition) => condition.field === "to")?.value ?? [];
  return typeof value === "string" ? [value] : value;
}

async function subject() {
  const clock = createManualClock(1_790_000_000_000);
  const privy = createFakePrivy({ clock, random: createSeededRandom(5) });
  const api = createPrivyApi({
    http: privy.http,
    clock,
    appId: privy.appId,
    appSecret: privy.appSecret,
  });
  const owner = createP256KeyPair();
  const quorum = await api.createKeyQuorum(
    { publicKey: owner.publicKey, displayName: "owner" },
    live,
  );
  const ceiling = buildCeiling({ ...testCeilingRequest(), rescue, saved: [saved] });
  if (!ceiling.ok) {
    throw new Error("Expected the test ceiling.");
  }
  const policy = await api.createPolicy({ ceiling: ceiling.value, owner: quorum.id }, live);
  const editor = createPrivyCeilingEditor({
    api,
    clock,
    ownerKeyPublic: async () => Promise.resolve(owner.publicKey),
    callsOn,
    ...capsOptions,
  });
  // The accounts the native send rule lists, as Privy holds the policy.
  const recipients = async (): Promise<readonly AccountRef[]> => {
    const held = await api.policy(policy.id, live);
    const rules = (held.ok ? held.value.rules : []) as unknown as readonly RuleJson[];
    const sends = rules.find((rule) => rule.name === "Native sends, chain 56");
    return listedIn(sends).map(accountOf).toSorted();
  };
  return {
    editor,
    ownerKey: formatOwnerKeyCode(owner),
    otherKey: formatOwnerKeyCode(createP256KeyPair()),
    ceiling: policy.id,
    unknownCeiling: "nosuchpolicy000000000000",
    accounts,
    venues: { known: "swap", unknown: "none" },
    recipients,
    now: () => clock.now(),
  };
}

describe("the Privy ceiling editor", () => {
  it.each(ceilingEditorContract({ create: subject }))(
    "follows the ceiling editor contract: $name",
    async ({ run }) => {
      await expect(run()).resolves.toBeUndefined();
    },
  );

  it("reads each 24-hour cap with its token, window and size at the floor price", async () => {
    const made = await subject();
    const read = await made.editor.read(made.ceiling, live);

    expect(read).toMatchObject({
      ok: true,
      value: {
        dayCaps: [
          {
            asset: nativeAsset,
            limit: 3n * 10n ** 18n,
            windowSeconds: 86_400,
            floorUsdMicros: 300_000_000n,
          },
          {
            asset: tokenAsset,
            limit: 1_000n,
            windowSeconds: 86_400,
            floorUsdMicros: 1_000_000_000n,
          },
        ],
      },
    });
  });

  it("refuses every owner key before the install holds one", async () => {
    const made = await subject();
    const editor = createPrivyCeilingEditor({
      api: createPrivyApi({
        http: createFakePrivy({ clock: createManualClock(1), random: createSeededRandom(1) }).http,
        clock: createManualClock(1),
        appId: "app",
        appSecret: made.ownerKey,
      }),
      clock: createManualClock(1),
      ownerKeyPublic: async () => Promise.resolve(undefined),
      callsOn,
      ...capsOptions,
    });
    const request = {
      ownerKey: made.ownerKey,
      ceilings: [{ ceiling: made.ceiling, recipients: [accounts[0]] }],
    };

    expect(await editor.setRecipients(request, live)).toStrictEqual({
      ok: false,
      error: "bad_owner_key",
    });
  });
});
