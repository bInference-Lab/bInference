import type { VenueDeclaration } from "@binference/chain";
import {
  baseMainnet,
  bsc,
  bscBridgeRoutes,
  bscCeilingCaps,
  bscVenueCalls,
  robinhood,
  solana,
} from "@binference/chains";
import { buildCeiling, registryCeilingChain } from "@binference/custody-privy";
import { testCaps } from "@binference/custody-privy/testing";
import { describe, expect, it } from "vitest";

const venues: readonly VenueDeclaration[] = Object.entries(bscVenueCalls).map(
  ([id, contracts]) => ({
    id,
    contracts: [contracts],
  }),
);
const saved = "0xeA6F82DbD6C87DE5E542eFbd1f9964879828e4e7";
// The install's caps with each capped token BSC's data names, as init makes them.
const caps = {
  ...testCaps,
  approvals: bscCeilingCaps.tokens.map((item, index) => ({
    aggregation: `testcaproute${String(index).padStart(13, "0")}`,
    limitBase: 1_000n,
    token: bsc.tokens.find((token) => token.symbol === item.symbol)?.address ?? "",
  })),
};
const rescue = "0x30435f9D276c6BC54F56161Fb3dFB7bDC2a8DBcB";

function planFor(role: "bridge" | undefined) {
  return registryCeilingChain({
    definition: bsc,
    venues,
    perTxNativeCapBase: 10n ** 18n,
    ...(role === undefined ? {} : { role }),
    bridges: {
      routes: bscBridgeRoutes,
      destinations: [baseMainnet, robinhood, solana],
    },
  });
}

function rulesFor(role: "bridge" | undefined): readonly string[] {
  const plan = planFor(role);
  if (!plan.ok) {
    return [plan.error];
  }
  const bridged = ["8453", "4663"].map((chainId) => ({ chainId, addresses: [saved] }));
  const built = buildCeiling({
    chains: [{ ...plan.value, caps }],
    rescue,
    saved: bridged,
    bridged,
  });
  return built.ok ? built.value.rules.map((rule) => rule.name) : [built.error];
}

describe("a ceiling built from the staking, bridge and identity calls on BSC", () => {
  it("allows Across's deposit to each saved destination its routes reach, and no Relay call", () => {
    expect(rulesFor(undefined)).toStrictEqual([
      "Call delegate, own cap, chain 56",
      "Call undelegate, chain 56",
      "Call claim, chain 56",
      "Call deposit, chain 56",
      "Call requestWithdraw, chain 56",
      "Call claimWithdrawByUUID, chain 56",
      "Call register, chain 56",
      "Bridge depositV3, chain 56 to 8453, 1",
      "Bridge depositV3, chain 56 to 8453, 2",
      "Bridge depositV3, chain 56 to 8453, 3",
      "Bridge depositV3, chain 56 to 4663, 1",
      "Approvals, chain 56",
      "Native sends, chain 56",
      "Token sends, chain 56",
      "Self cancel, chain 56",
      "Owner export",
    ]);
  });

  it("adds Relay's token deposit, and never its coin deposit, to a bridge wallet's ceiling alone", () => {
    const rules = rulesFor("bridge");
    expect(rules).toContain("Call depositErc20, chain 56");
    expect(rules).not.toContain("Call depositNative, chain 56");
    expect(rulesFor(undefined)).not.toContain("Call depositErc20, chain 56");
  });
});
