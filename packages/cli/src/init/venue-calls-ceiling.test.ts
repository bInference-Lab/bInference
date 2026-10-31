import type { VenueDeclaration } from "@binference/chain";
import {
  baseMainnet,
  bsc,
  bscBridgeRoutes,
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
const rescue = "0x30435f9D276c6BC54F56161Fb3dFB7bDC2a8DBcB";

function planFor(role: "bridge" | undefined) {
  return registryCeilingChain({
    definition: bsc,
    venues,
    perTxNativeCapBase: 10n ** 18n,
    ...(role === undefined ? {} : { role }),
    bridges: {
      routes: bscBridgeRoutes,
      destinations: [
        { definition: baseMainnet, recipients: [saved] },
        { definition: robinhood, recipients: [saved] },
        { definition: solana, recipients: [saved] },
      ],
    },
  });
}

function rulesFor(role: "bridge" | undefined): readonly string[] {
  const plan = planFor(role);
  if (!plan.ok) {
    return [plan.error];
  }
  const built = buildCeiling({ chains: [{ ...plan.value, caps: testCaps }], rescue, saved: [] });
  return built.ok ? built.value.rules.map((rule) => rule.name) : [built.error];
}

describe("a ceiling built from the staking, bridge and identity calls on BSC", () => {
  it("allows Across's deposit to each saved destination its routes reach, and no Relay call", () => {
    expect(rulesFor(undefined)).toStrictEqual([
      "Call delegate, chain 56",
      "Call undelegate, chain 56",
      "Call claim, chain 56",
      "Call deposit, chain 56",
      "Call requestWithdraw, chain 56",
      "Call claimWithdraw, chain 56",
      "Call register, chain 56",
      "Bridge depositV3, chain 56 to 8453",
      "Bridge depositV3, chain 56 to 4663",
      "Approvals, chain 56",
      "Native sends, chain 56",
      "Token sends, chain 56",
      "Self cancel, chain 56",
      "Owner export",
    ]);
  });

  it("adds Relay's deposits to a bridge wallet's ceiling alone", () => {
    const rules = rulesFor("bridge");
    expect(rules).toStrictEqual(
      expect.arrayContaining(["Call depositErc20, chain 56", "Call depositNative, chain 56"]),
    );
    expect(rulesFor(undefined)).not.toContain("Call depositErc20, chain 56");
  });
});
