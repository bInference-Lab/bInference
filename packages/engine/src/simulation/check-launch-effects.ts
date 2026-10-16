import {
  type AccountRef,
  type Amount,
  type AssetRef,
  type ChainFamily,
  isSameAccount,
  type SimulatedStep,
  type TokenApproval,
} from "@binference/chain";
import { err, ok, type Result } from "@binference/core";
import type { SimulationMismatch } from "./check-effects.js";
import { walletChanges } from "./wallet-changes.js";

/** What a token launch's steps may do to its launch wallet (decision 0234). */
export interface LaunchEffectBounds {
  readonly wallet: AccountRef;
  readonly nativeAsset: AssetRef;
  /** The launch fee, in the chain's coin, which leaves the wallet with the create call. */
  readonly fee: Amount;
  /** What the first buy spends; absent for a launch with no first buy. */
  readonly firstBuy?: Amount;
  /** The token the create call makes. */
  readonly token: AssetRef;
  /** The least of the token the first buy accepts; with a first buy alone. */
  readonly minOutBase?: bigint;
  /** What the plan's approval steps grant: the only allowances the wallet may set. */
  readonly approvals: readonly TokenApproval[];
  readonly family: ChainFamily;
}

/** What a launch's steps spent and received, net, as the intent's simulation stores it. */
export interface LaunchEffects {
  readonly spent: readonly Amount[];
  readonly received: readonly Amount[];
}

// What leaves the wallet: the fee and a first buy in the chain's coin, or the coin's fee and a
// first buy in a token.
function spentOf(bounds: LaunchEffectBounds): ReadonlyMap<AssetRef, bigint> {
  const { fee, firstBuy } = bounds;
  const spent = new Map<AssetRef, bigint>([[fee.asset, fee.base]]);
  if (firstBuy !== undefined) {
    spent.set(firstBuy.asset, (spent.get(firstBuy.asset) ?? 0n) + firstBuy.base);
  }
  return spent;
}

// Exactly the spend leaves; the token arrives with a first buy alone; nothing else changes.
function balanceMismatch(
  changes: ReadonlyMap<AssetRef, bigint>,
  bounds: LaunchEffectBounds,
): SimulationMismatch | undefined {
  const spent = spentOf(bounds);
  for (const [asset, base] of spent) {
    if ((changes.get(asset) ?? 0n) !== -base) {
      return "other_amount";
    }
  }
  const received = changes.get(bounds.token) ?? 0n;
  if (bounds.firstBuy !== undefined && received < (bounds.minOutBase ?? 0n)) {
    return "low_out";
  }
  const others = [...changes].filter(
    ([asset, change]: readonly [AssetRef, bigint]) =>
      change !== 0n && asset !== bounds.token && !spent.has(asset),
  );
  return others.length === 0 ? undefined : "other_asset";
}

// An allowance the wallet sets is on the first buy's spend, at most it, for a granted spender.
function hasOtherApproval(steps: readonly SimulatedStep[], bounds: LaunchEffectBounds): boolean {
  const { firstBuy, wallet, family } = bounds;
  return steps
    .flatMap((step) => step.approvals)
    .filter((approval) => isSameAccount(approval.owner, wallet, family))
    .some(
      ({ amount, spender }) =>
        amount.asset !== firstBuy?.asset ||
        amount.base > firstBuy.base ||
        !bounds.approvals.some((granted) => isSameAccount(granted.spender, spender, family)),
    );
}

/**
 * The simulation check of a token launch (decision 0234): no step reverts; the wallet spends
 * exactly the launch fee and the first buy, net; with a first buy it receives at least its minimum
 * of the token the create call makes; no other balance changes; and it sets no allowance but on
 * the first buy's spend, up to it, for a spender the plan's approval names. Gives what the wallet
 * spent and received, or the first check that fails.
 */
export function checkLaunchEffects(
  steps: readonly SimulatedStep[],
  bounds: LaunchEffectBounds,
): Result<LaunchEffects, SimulationMismatch> {
  if (steps.some((step) => step.status === "reverted")) {
    return err("reverted");
  }
  const changes = walletChanges(
    steps.flatMap((step) => step.transfers),
    bounds,
  );
  const mismatch =
    balanceMismatch(changes, bounds) ??
    (hasOtherApproval(steps, bounds) ? "other_approval" : undefined);
  if (mismatch !== undefined) {
    return err(mismatch);
  }
  const spent = [...spentOf(bounds)].map(([asset, base]: readonly [AssetRef, bigint]) => ({
    asset,
    base,
  }));
  const received =
    bounds.firstBuy === undefined
      ? []
      : [{ asset: bounds.token, base: changes.get(bounds.token) ?? 0n }];
  return ok({ spent, received });
}
