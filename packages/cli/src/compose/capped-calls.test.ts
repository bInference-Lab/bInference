import { assetRefSchema } from "@binference/chain";
import { createManualClock, createSeededRandom } from "@binference/core/testing";
import {
  type BridgeDeposit,
  buildCeiling,
  type CeilingChainPlan,
  type ChainCapPlan,
  createPrivyApi,
  readCeiling,
} from "@binference/custody-privy";
import {
  bridgeAddresses,
  createFakePrivy,
  testAddresses,
  testBridgeCall,
  testCalls,
  testCapPlan,
  testCeilingRequest,
  testChain,
} from "@binference/custody-privy/testing";
import { createP256KeyPair, formatOwnerKeyCode } from "@binference/signer";
import { describe, expect, it } from "vitest";
import { createPrivyCeilingEditor } from "./privy-ceiling-editor.js";

const live = { signal: new AbortController().signal };
const { rescue, saved, router, token } = testAddresses;
const { bscEth, baseUsdc, spokePool } = bridgeAddresses;

// A deposit to Base taking the test token, and with `withEth`, ETH too.
function depositsOf({ withEth }: { readonly withEth: boolean }): readonly BridgeDeposit[] {
  const routes = [
    { tokenIn: token, tokenOut: baseUsdc },
    ...(withEth ? [{ tokenIn: bscEth, tokenOut: baseUsdc }] : []),
  ];
  return [{ call: testBridgeCall, destinationChainId: "8453", routes }];
}

// The test venues on the test chain: "swap" calls the router; "across" approves its spoke pool and
// deposits through it, on the routes `routes` names.
function callsOnWith(routes: { readonly withEth: boolean }) {
  return (
    chain: unknown,
    calls: {
      readonly venues: readonly string[];
      readonly perTxNativeBase: bigint;
      readonly isLaunch?: true;
    },
  ): CeilingChainPlan => ({
    chain: testChain,
    // A launch wallet's ceiling here also calls the deposit as a plain call, which no ceiling holds.
    calls:
      calls.isLaunch === true ? [...testCalls, { ...testBridgeCall, walletInputs: [] }] : testCalls,
    spenders: [router, ...(calls.venues.includes("across") ? [spokePool] : [])],
    perTxNativeCapBase: calls.perTxNativeBase,
    ...(calls.venues.includes("across") ? { bridges: depositsOf(routes) } : {}),
  });
}

// The plan the install's binference sizes now: the test token, then ETH, joined later at the end.
function planWith(extra: number): ChainCapPlan {
  const more = Array.from({ length: extra }, (_, index) => ({
    token: `0x${(index + 1).toString(16).padStart(40, "0")}`,
    limitBase: 1n,
  }));
  return {
    ...testCapPlan,
    approvals: [...testCapPlan.approvals, { token: bscEth, limitBase: 10n ** 18n }, ...more],
  };
}

const nativeAsset = assetRefSchema.parse("eip155:56/slip44:714");
const tokenAsset = assetRefSchema.parse(`eip155:56/erc20:${token}`);
const ethAsset = assetRefSchema.parse(`eip155:56/erc20:${bscEth}`);

// Two ceilings made before ETH's cap joined the plan: one token cap, and a deposit of the token to
// the address saved for Base.
async function oldInstall(extra = 0) {
  const clock = createManualClock(1_790_000_000_000);
  const privy = createFakePrivy({ clock, random: createSeededRandom(7) });
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
  const request = testCeilingRequest();
  const chains = request.chains.map((chain) =>
    Object.assign({}, chain, {
      spenders: [router, spokePool],
      bridges: depositsOf({ withEth: false }),
      caps: { ...chain.caps, approvals: chain.caps.approvals.map((cap) => ({ ...cap, token })) },
    }),
  );
  const bridged = [{ chainId: "8453", addresses: [saved] }];
  const ceiling = buildCeiling({ ...request, chains, rescue, saved: [saved], bridged });
  if (!ceiling.ok) {
    throw new Error(ceiling.error);
  }
  const policies = [
    await api.createPolicy({ ceiling: ceiling.value, owner: quorum.id }, live),
    await api.createPolicy({ ceiling: ceiling.value, owner: quorum.id }, live),
  ];
  const editor = createPrivyCeilingEditor({
    api,
    clock,
    ownerKeyPublic: async () => Promise.resolve(owner.publicKey),
    callsOn: callsOnWith({ withEth: true }),
    capPlanOn: () => planWith(extra),
    capAssetsOn: () => ({
      native: { asset: nativeAsset, decimals: 18, floorUsd: 100_000_000n },
      tokens: [
        { asset: tokenAsset, token, decimals: 0, floorUsd: 1_000_000n },
        { asset: ethAsset, token: bscEth, decimals: 18, floorUsd: 500_000_000n },
      ],
    }),
    heldCaps: async () => Promise.resolve([]),
  });
  const rulesOf = async (index: number) => {
    const id = policies[index]?.id;
    const policy = id === undefined ? undefined : await api.policy(id, live);
    return policy?.ok === true ? policy.value.rules : [];
  };
  const held = async (index: number) => readCeiling(await rulesOf(index));
  const names = async (index: number) =>
    (await rulesOf(index)).map((rule) => (rule as { readonly name: string }).name);
  const change = {
    ownerKey: formatOwnerKeyCode(owner),
    ceilings: policies.map((policy) => ({
      ceiling: policy.id,
      venues: ["swap", "across"],
      perTxNativeBase: 10n ** 18n,
    })),
  };
  // The same change with the second ceiling a launch wallet's.
  const launching = {
    ...change,
    ceilings: change.ceilings.map((calls, index) =>
      index === 1 ? { ...calls, isLaunch: true as const } : calls,
    ),
  };
  return { editor, held, names, request: change, launching };
}

describe("a change of calls one ceiling of which cannot be built", () => {
  it("writes no ceiling, the ones planned before it neither", async () => {
    const install = await oldInstall();
    const before = await install.names(0);

    expect(await install.editor.setCalls(install.launching, live)).toStrictEqual({
      ok: false,
      error: "bad_bridge",
    });
    expect(await install.names(0)).toStrictEqual(before);
  });
});

describe("a change of calls that adds a bridge route for ETH", () => {
  it("adds ETH's 24-hour cap to every ceiling of an old install in the same change", async () => {
    const install = await oldInstall();

    expect(await install.editor.setCalls(install.request, live)).toStrictEqual({
      ok: true,
      value: undefined,
    });

    const [first, second] = [await install.held(0), await install.held(1)];
    expect(first?.caps[0]?.caps.approvals).toHaveLength(2);
    expect(second?.caps[0]?.caps.approvals).toStrictEqual(first?.caps[0]?.caps.approvals);
    expect(await install.names(0)).toContain("Bridge depositV3, chain 56 to 8453, 2");
  });

  it("adds no ETH route when its cap cannot be made", async () => {
    const install = await oldInstall(9);

    expect(await install.editor.setCalls(install.request, live)).toStrictEqual({
      ok: false,
      error: "uncapped_token",
    });

    const first = await install.held(0);
    expect(first?.caps[0]?.caps.approvals).toHaveLength(1);
    expect(await install.names(0)).toContain("Bridge depositV3, chain 56 to 8453, 1");
    expect(await install.names(0)).not.toContain("Bridge depositV3, chain 56 to 8453, 2");
  });
});
