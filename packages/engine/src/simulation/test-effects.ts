import {
  type AccountRef,
  accountRefSchema,
  type Amount,
  type AssetApproval,
  type AssetRef,
  assetRefSchema,
  type AssetTransfer,
  type SimulatedStep,
} from "@binference/chain";
import { createFakeFamily } from "@binference/chain/testing";
import type { EffectBounds } from "./check-effects.js";

/** Accounts on the fake chain: the wallet, the venue's router and pair, and a stranger. */
export const effectAccounts: Readonly<Record<"wallet" | "router" | "pair" | "thief", AccountRef>> =
  {
    wallet: accountRefSchema.parse("fake:1:0x0000000c"),
    router: accountRefSchema.parse("fake:1:0x0000000b"),
    pair: accountRefSchema.parse("fake:1:0x0000000d"),
    thief: accountRefSchema.parse("fake:1:0x0000000e"),
  };

/** The fake chain's coin, its listed token, and a token the trade never names. */
export const effectAssets: Readonly<Record<"coin" | "token" | "other", AssetRef>> = {
  coin: assetRefSchema.parse("fake:1/slip44:1"),
  token: assetRefSchema.parse("fake:1/token:0x0000000a"),
  other: assetRefSchema.parse("fake:1/token:0x0000000f"),
};

const { wallet, router, pair } = effectAccounts;

/** Base units of the coin, the token or the other token. */
export const coins = (base: bigint): Amount => ({ asset: effectAssets.coin, base });
export const tokens = (base: bigint): Amount => ({ asset: effectAssets.token, base });
export const others = (base: bigint): Amount => ({ asset: effectAssets.other, base });

/** A sale of 1,000,000 of the token for at least 1,990,000 of the coin, approved exactly. */
export const saleBounds: EffectBounds = {
  wallet,
  amountIn: tokens(1_000_000n),
  minOut: coins(1_990_000n),
  approvals: [{ asset: effectAssets.token, spender: router, amountBase: 1_000_000n }],
  family: createFakeFamily(),
};

/** An amount moved between two accounts. */
export function moved(from: AccountRef, to: AccountRef, amount: Amount): AssetTransfer {
  return { from, to, amount };
}

/** An allowance the wallet sets for a spender. */
export function allowed(spender: AccountRef, amount: Amount): AssetApproval {
  return { owner: wallet, spender, amount };
}

/** A step that succeeded with these transfers and approvals. */
export function step(
  transfers: readonly AssetTransfer[],
  approvals: readonly AssetApproval[] = [],
): SimulatedStep {
  return { status: "success", gasUsed: 100_000n, transfers, approvals };
}

/**
 * The sale's steps as a node reports them: the exact approval, then the router pulls the token
 * into the pair (spending the allowance down to 0) and the coin comes back through the router.
 * `extra` joins the trade step's transfers.
 */
export function saleSteps(extra: readonly AssetTransfer[] = []): readonly SimulatedStep[] {
  return [
    step([], [allowed(router, tokens(1_000_000n))]),
    step(
      [
        moved(wallet, pair, tokens(1_000_000n)),
        moved(pair, router, coins(2_000_000n)),
        moved(router, wallet, coins(2_000_000n)),
        ...extra,
      ],
      [allowed(router, tokens(0n))],
    ),
  ];
}
