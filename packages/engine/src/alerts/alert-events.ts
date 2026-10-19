import { type AssetRef, canonicalAsset, type ChainRegistry } from "@binference/chain";
import type { Id } from "@binference/core";
import { canonicalAccount } from "../operations/canonical-account.js";
import type { AlertKind, AlertRecord } from "./alert-record.js";
import type { WatchedLaunch, WatchedTrade } from "./fire-alerts.js";
import type { AlertStore } from "./ports.js";

const pageSize = 1_000;

/**
 * Every active alert of a kind, of price alerts on one asset when given, page after page until a
 * page comes back empty.
 */
export async function activeAlerts(
  alerts: Pick<AlertStore, "list">,
  query: { readonly kind: AlertKind; readonly asset?: AssetRef },
  call: {
    readonly signal: AbortSignal;
    readonly after?: { readonly createdAtMs: number; readonly id: Id<"alr"> };
  },
): Promise<readonly AlertRecord[]> {
  const { signal, after } = call;
  const base = { states: ["active" as const], limit: pageSize, ...query };
  const page = await alerts.list(after === undefined ? base : { ...base, after }, { signal });
  const last = page.at(-1);
  if (last === undefined) {
    return page;
  }
  const cursor = { createdAtMs: last.createdAtMs, id: last.id };
  return [...page, ...(await activeAlerts(alerts, query, { signal, after: cursor }))];
}

// An asset in its family's canonical form, or as given when no chain of the registry reads it.
function assetOf(chains: ChainRegistry, asset: AssetRef): AssetRef {
  const canonical = canonicalAsset(chains, asset);
  return canonical.ok ? canonical.value : asset;
}

/**
 * A trade with its account and assets in their families' canonical forms, which `alert/create`
 * stores, so a watcher that hands an address in another case still matches.
 */
export function canonicalTrade(chains: ChainRegistry, trade: WatchedTrade): WatchedTrade {
  const account = canonicalAccount(chains, trade.account);
  const { activity } = trade;
  return {
    ...trade,
    account: account.ok ? account.value : trade.account,
    activity: {
      ...activity,
      asset: assetOf(chains, activity.asset),
      counterAsset: assetOf(chains, activity.counterAsset),
    },
  };
}

/** A launch with its token and quote token in their families' canonical forms. */
export function canonicalLaunch(chains: ChainRegistry, launch: WatchedLaunch): WatchedLaunch {
  const view = launch.launch;
  return {
    ...launch,
    launch: {
      ...view,
      token: assetOf(chains, view.token),
      quoteToken: assetOf(chains, view.quoteToken),
    },
  };
}
