import { type AssetRef, canonicalAsset, type ChainRegistry } from "@binference/chain";
import { err, ok, type Result } from "@binference/core";
import type { AlertCondition, ProtocolErrorCode, WalletCondition } from "@binference/protocol";
import { checkLaunchFilter } from "../launches/check-launch-filter.js";
import { canonicalAccount } from "../operations/canonical-account.js";

/** How long a wallet or launch alert lasts when it names no expiry: 30 days (spec 1, 8.4). */
export const defaultAlertLifetimeMs = 2_592_000_000;

/** What the rules of a new alert read: the time, the registry, and which venues are launchpads. */
export interface AlertRuleContext {
  readonly nowMs: number;
  readonly chains: ChainRegistry;
  readonly isLaunchpad: (venue: string) => boolean;
}

/** A new alert's condition in its canonical form, and when it ends, if ever. */
export interface CheckedAlert {
  readonly condition: AlertCondition;
  readonly expiresAtMs?: number;
}

type Checked<T> = Result<T, ProtocolErrorCode>;

const badArgs = err("protocol.bad_args");

function assetOf(chains: ChainRegistry, asset: AssetRef): Checked<AssetRef> {
  const canonical = canonicalAsset(chains, asset);
  return canonical.ok ? canonical : badArgs;
}

function walletOf(chains: ChainRegistry, condition: WalletCondition): Checked<WalletCondition> {
  const account = canonicalAccount(chains, condition.account);
  const asset = condition.asset === undefined ? undefined : assetOf(chains, condition.asset);
  const { minUsdMicros } = condition;
  if (!account.ok || asset?.ok === false || (minUsdMicros !== undefined && minUsdMicros <= 0n)) {
    return badArgs;
  }
  return ok({
    ...condition,
    account: account.value,
    ...(asset === undefined ? {} : { asset: asset.value }),
  });
}

function conditionOf(
  context: AlertRuleContext,
  condition: AlertCondition,
): Checked<AlertCondition> {
  if (condition.kind === "price") {
    const asset = assetOf(context.chains, condition.asset);
    return asset.ok && condition.price > 0n ? ok({ ...condition, asset: asset.value }) : badArgs;
  }
  if (condition.kind === "wallet") {
    return walletOf(context.chains, condition);
  }
  const filters = checkLaunchFilter(context, condition.filters);
  return filters.ok ? ok({ ...condition, filters: filters.value }) : filters;
}

/**
 * Checks an `alert/create` condition and fills its defaults (protocol spec, section 8.4): its
 * assets and account in their canonical forms, a price and a least dollar value above zero,
 * launchpads this engine runs, and an expiry in the future, 30 days on by default for a wallet or
 * launch alert and none for a price alert. A broken rule is `protocol.bad_args`.
 */
export function checkAlertRequest(
  request: { readonly condition: AlertCondition; readonly expiresAt?: number },
  context: AlertRuleContext,
): Checked<CheckedAlert> {
  const { condition, expiresAt } = request;
  if (expiresAt !== undefined && expiresAt <= context.nowMs) {
    return badArgs;
  }
  const checked = conditionOf(context, condition);
  if (!checked.ok) {
    return checked;
  }
  const lasting = condition.kind === "price" ? undefined : context.nowMs + defaultAlertLifetimeMs;
  const expiresAtMs = expiresAt ?? lasting;
  return ok({ condition: checked.value, ...(expiresAtMs === undefined ? {} : { expiresAtMs }) });
}
