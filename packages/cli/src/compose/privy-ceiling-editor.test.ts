import { type AccountRef, accountRefSchema } from "@binference/chain";
import { createManualClock, createSeededRandom } from "@binference/core/testing";
import { buildCeiling, type CeilingChainPlan, createPrivyApi } from "@binference/custody-privy";
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

const capsOptions = {
  capPlanOn: () => testCapPlan,
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
