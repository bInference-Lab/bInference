import {
  type AccountRef,
  type Amount,
  type AssetApproval,
  type AssetRef,
  type AssetTransfer,
  type ChainFamily,
  isSameAccount,
  type SimulatedStep,
  type TokenApproval,
} from "@binference/chain";
import { err, ok, type Result } from "@binference/core";
import type { SimulationFailure } from "../intents/intent-reason.js";

/**
 * Why the simulation check refused a trade's steps (ARCHITECTURE.md section 7, step 5), in the
 * order it checks them. The intent stores `simulation_reverted` for `reverted` and
 * `effects_differ` for every other code.
 */
export const simulationMismatches = [
  "reverted",
  "other_outflow",
  "other_amount",
  "low_out",
  "other_asset",
  "other_approval",
] as const;

/** A check of the simulation step that a trade's steps failed. */
export type SimulationMismatch = (typeof simulationMismatches)[number];

/** What a trade's steps may do to its wallet. */
export interface EffectBounds {
  /** The agent's wallet, which signs every step. */
  readonly wallet: AccountRef;
  /** The exact input: the one asset that may leave the wallet, and how much leaves it net. */
  readonly amountIn: Amount;
  /** The least of the output asset the wallet receives net. */
  readonly minOut: Amount;
  /**
   * What the plan's approval steps grant. The wallet may set an allowance only on the input, up to
   * the input, for a spender one of them names.
   */
  readonly approvals: readonly TokenApproval[];
  /** The family of the wallet's chain, which compares accounts. */
  readonly family: ChainFamily;
}

/** The wallet's net balance changes of steps that passed: what it spent and what it received. */
export interface NetEffects {
  readonly spent: Amount;
  readonly received: Amount;
}

// A transfer's change to the wallet's balance: what leaves counts against it, what arrives for
// it, and a transfer the wallet makes to itself, or one between others, not at all.
function changeOf(transfer: AssetTransfer, bounds: EffectBounds): bigint {
  const leaves = isSameAccount(transfer.from, bounds.wallet, bounds.family);
  const arrives = isSameAccount(transfer.to, bounds.wallet, bounds.family);
  if (leaves === arrives) {
    return 0n;
  }
  return leaves ? -transfer.amount.base : transfer.amount.base;
}

function netChanges(
  transfers: readonly AssetTransfer[],
  bounds: EffectBounds,
): ReadonlyMap<AssetRef, bigint> {
  const changes = new Map<AssetRef, bigint>();
  for (const transfer of transfers) {
    const { asset } = transfer.amount;
    changes.set(asset, (changes.get(asset) ?? 0n) + changeOf(transfer, bounds));
  }
  return changes;
}

// Only the input leaves the wallet: any other asset leaving it, even one the trade gives back,
// goes somewhere the intent never named.
function hasOtherOutflow(transfers: readonly AssetTransfer[], bounds: EffectBounds): boolean {
  return transfers.some(
    (transfer) =>
      transfer.amount.asset !== bounds.amountIn.asset && changeOf(transfer, bounds) < 0n,
  );
}

// An asset the intent never names changed in the wallet: it arrived unasked.
function hasOtherChange(changes: ReadonlyMap<AssetRef, bigint>, bounds: EffectBounds): boolean {
  for (const [asset, change] of changes) {
    if (change !== 0n && asset !== bounds.amountIn.asset && asset !== bounds.minOut.asset) {
      return true;
    }
  }
  return false;
}

function balanceMismatch(
  changes: ReadonlyMap<AssetRef, bigint>,
  received: Amount,
  bounds: EffectBounds,
): SimulationMismatch | undefined {
  const { amountIn, minOut } = bounds;
  if (-(changes.get(amountIn.asset) ?? 0n) !== amountIn.base) {
    return "other_amount";
  }
  if (received.base < minOut.base) {
    return "low_out";
  }
  return hasOtherChange(changes, bounds) ? "other_asset" : undefined;
}

// An allowance the wallet sets is on the input, at most the input, for a spender a plan's approval
// step names, and at most what that step grants: the grant, or what is left of it as the trade
// spends it. The check cannot tell any other allowance, even one the trade only spends down, from
// a new grant.
function isGranted(approval: AssetApproval, bounds: EffectBounds): boolean {
  const { asset, base } = approval.amount;
  const isInput = asset === bounds.amountIn.asset && base <= bounds.amountIn.base;
  return (
    isInput &&
    bounds.approvals.some(
      (granted) =>
        granted.asset === asset &&
        base <= granted.amountBase &&
        isSameAccount(granted.spender, approval.spender, bounds.family),
    )
  );
}

function hasOtherApproval(steps: readonly SimulatedStep[], bounds: EffectBounds): boolean {
  return steps
    .flatMap((step) => step.approvals)
    .some(
      (approval) =>
        isSameAccount(approval.owner, bounds.wallet, bounds.family) && !isGranted(approval, bounds),
    );
}

/**
 * The simulation check of the money path: the steps' net balance changes must match the intent.
 * No step reverts; only the input asset leaves the wallet, exactly the input net; at least the
 * minimum out of the output asset arrives net; no other asset's balance changes; and the wallet
 * sets no allowance but on the input, up to the input, as the plan's approval steps grant. The
 * network fee is never among the transfers, so it is counted apart. Gives the wallet's net
 * changes, or the first check that fails.
 */
export function checkEffects(
  steps: readonly SimulatedStep[],
  bounds: EffectBounds,
): Result<NetEffects, SimulationMismatch> {
  if (steps.some((step) => step.status === "reverted")) {
    return err("reverted");
  }
  const transfers = steps.flatMap((step) => step.transfers);
  if (hasOtherOutflow(transfers, bounds)) {
    return err("other_outflow");
  }
  const changes = netChanges(transfers, bounds);
  const received = { asset: bounds.minOut.asset, base: changes.get(bounds.minOut.asset) ?? 0n };
  const mismatch =
    balanceMismatch(changes, received, bounds) ??
    (hasOtherApproval(steps, bounds) ? "other_approval" : undefined);
  if (mismatch !== undefined) {
    return err(mismatch);
  }
  return ok({ spent: { asset: bounds.amountIn.asset, base: bounds.amountIn.base }, received });
}

/** The reason an intent stores for a failed simulation check. */
export function simulationFailureOf(mismatch: SimulationMismatch): SimulationFailure {
  return mismatch === "reverted" ? "simulation_reverted" : "effects_differ";
}
