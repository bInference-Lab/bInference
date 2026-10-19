import type { AccountRef, ChainRegistry } from "@binference/chain";
import { type Clock, type IdSource, jsonValueSchema, mulDiv } from "@binference/core";
import {
  type ActivityItem,
  type AlertFire,
  type AlertFired,
  alertFiredSchema,
  type AssetInfos,
  type LaunchView,
} from "@binference/protocol";
import type { AgentSettings } from "../agents/agent-record.js";
import type { ModelBudget } from "../billing/model-budget.js";
import type { AgentInboxMessage } from "../chat/agent-inbox-record.js";
import { alertFiredPayloadSchema } from "../chat/inbox-payload.schema.js";
import { wakeSkipOf } from "../chat/wake-skip.js";
import { type AssetSources, knownAssetInfos } from "../money-path/asset-infos.js";
import type { WatchedOrderPrice } from "../orders/order-triggers.js";
import { wholeTokenPrice } from "../orders/price-level.js";
import type { AgentStore, IntentStore } from "../ports.js";
import type { PublishPush } from "../pushes/engine-push.js";
import { noticePush } from "../pushes/notice-push.js";
import { type AlertFireDraft, alertAfterFire } from "./alert-fire.js";
import { launchPasses, priceMeets, tradeMatches } from "./alert-matches.js";
import { alertNotice } from "./alert-notices.js";
import type { AlertKind, AlertRecord } from "./alert-record.js";
import { alertViewOf } from "./alert-view-of.js";
import type { AlertStore } from "./ports.js";

/** One trade of a watched wallet, as the leader watcher reads it, with its tokens' info. */
export interface WatchedTrade {
  readonly account: AccountRef;
  readonly activity: ActivityItem;
  readonly assets: AssetInfos;
}

/** One new launch, as the launch feed reads it, with its liquidity when read and its tokens. */
export interface WatchedLaunch {
  readonly launch: LaunchView;
  readonly liquidityUsdMicros?: bigint;
  readonly assets: AssetInfos;
}

/**
 * The alert firing (protocol spec, section 8.4): each watcher hands what it read, and every
 * active alert it matches fires once for it, records the fire, pushes `alert/fired`, tells the
 * owner and, for an alert with `wake`, stores the agent's wake-up. It reaches no money path: an
 * alert never stores an intent or sends a transaction. Each call answers the fires it wrote.
 */
export interface AlertFiring {
  /** A confirmed price from the price watcher: fires the price alerts on its token at its level. */
  seePrice(
    price: WatchedOrderPrice,
    call: { readonly signal: AbortSignal },
  ): Promise<readonly AlertFired[]>;
  /** A wallet's trade from the leader watcher: fires the wallet alerts it matches. */
  seeTrade(
    trade: WatchedTrade,
    call: { readonly signal: AbortSignal },
  ): Promise<readonly AlertFired[]>;
  /** A new launch from the launch feed: fires the launch alerts whose filters it passes. */
  seeLaunch(
    launch: WatchedLaunch,
    call: { readonly signal: AbortSignal },
  ): Promise<readonly AlertFired[]>;
  /** Ends each active alert whose expiry came, and answers how many ended. */
  expire(call: { readonly signal: AbortSignal }): Promise<number>;
}

/** What the firing reads, writes and tells through: no intent store, executor or venue. */
export interface AlertFiringParts {
  readonly alerts: AlertStore;
  readonly agents: Pick<AgentStore, "get">;
  /** Each agent's daily model budget: a wake-up starts no turn once it is spent. */
  readonly budget: Pick<ModelBudget, "open">;
  readonly chains: ChainRegistry;
  /** What proposals stored of tokens the registry does not list, for a price alert's notice. */
  readonly intents: Pick<IntentStore, "storedAssets">;
  /** Pushes a wake-up a fire stored on the `inbox` topic. */
  readonly woke: (message: AgentInboxMessage) => void;
  readonly ids: IdSource;
  readonly clock: Clock;
  readonly publish: PublishPush;
}

// The most alerts one read of the store hands over; an install holds at most 50 per agent.
const pageSize = 1_000;
// The most alerts one expiry call ends; the rest wait for the next call.
const expiriesPerCall = 100;

async function activeOf(
  parts: AlertFiringParts,
  kind: AlertKind,
  signal: AbortSignal,
): Promise<readonly AlertRecord[]> {
  return parts.alerts.list({ states: ["active"], kind, limit: pageSize }, { signal });
}

// The wake-up of an alert with `wake`, unless the agent cannot start a turn now. An alert reads
// outside data, so every wake-up starts its turn marked.
async function wakeOf(
  parts: AlertFiringParts,
  fire: { readonly alert: AlertRecord; readonly fired: AlertFire; readonly atMs: number },
  call: { readonly settings: AgentSettings | undefined; readonly signal: AbortSignal },
): Promise<Pick<AlertFireDraft, "wake" | "skip">> {
  const { alert, fired, atMs } = fire;
  if (!alert.wake) {
    return {};
  }
  const skip = await wakeSkipOf(parts.budget, call.settings, call.signal);
  if (skip !== undefined) {
    return { skip };
  }
  const view = alertViewOf(alertAfterFire(alert, atMs));
  const payload = { alert: view, fired, outsideContent: true };
  const { ids } = parts;
  return {
    wake: {
      id: ids.next("msg"),
      turnId: ids.next("trn"),
      opens: ids.next("ses"),
      payload: jsonValueSchema.parse(alertFiredPayloadSchema.encode(payload)),
    },
  };
}

// Fires one alert: one write records the fire and its wake-up; then the push and the notice. A
// fire another fire of the same alert beat writes nothing and answers nothing.
async function fireOne(
  parts: AlertFiringParts,
  fire: { readonly alert: AlertRecord; readonly fired: AlertFire; readonly assets: AssetInfos },
  signal: AbortSignal,
): Promise<AlertFired | undefined> {
  const { alert, fired, assets } = fire;
  const atMs = parts.clock.now();
  const settings = await parts.agents.get(alert.agentId, { signal });
  const wake = await wakeOf(parts, { alert, fired, atMs }, { settings, signal });
  const draft = { id: alert.id, expectedFires: alert.fires, atMs, ...wake };
  const written = await parts.alerts.fire(draft, { signal });
  if (!written.ok) {
    return undefined;
  }
  const { woke, wakeSkipped, message } = written.value;
  if (message !== undefined) {
    parts.woke(message);
  }
  const skipped = wakeSkipped === undefined ? {} : { wakeSkipped };
  const data: AlertFired = {
    alert: alert.id,
    agent: alert.agentId,
    at: atMs,
    fired,
    woke,
    ...skipped,
    assets,
  };
  parts.publish({
    topic: "alert",
    kind: "alert/fired",
    data: jsonValueSchema.parse(alertFiredSchema.encode(data)),
  });
  const agentName = settings?.agent.name ?? alert.agentId;
  const addressBook = settings?.addressBook ?? [];
  const context = { chains: parts.chains, addressBook, assets, nowMs: atMs };
  parts.publish(noticePush(alertNotice({ alert, fired, agentName, woke, ...skipped }, context)));
  return data;
}

// Fires the matched alerts one after the other, so one agent's fires land in order.
async function fireAll(
  parts: AlertFiringParts,
  matched: readonly { readonly alert: AlertRecord; readonly fired: AlertFire }[],
  call: { readonly assets: AssetInfos; readonly signal: AbortSignal },
): Promise<readonly AlertFired[]> {
  const fired: AlertFired[] = [];
  for (const each of matched) {
    // oxlint-disable-next-line eslint/no-await-in-loop -- one write at a time, in order
    const written = await fireOne(parts, { ...each, assets: call.assets }, call.signal);
    if (written !== undefined) {
      fired.push(written);
    }
  }
  return fired;
}

async function seePrice(
  parts: AlertFiringParts,
  price: WatchedOrderPrice,
  signal: AbortSignal,
): Promise<readonly AlertFired[]> {
  const whole = wholeTokenPrice(price.usdPerBaseUnit, price.decimals);
  const active = await activeOf(parts, "price", signal);
  const fired: AlertFire = {
    kind: "price",
    asset: price.token,
    priceUsdMicros: mulDiv(1n, whole, "down"),
  };
  const matched = active
    .filter(({ condition }) => condition.kind === "price" && condition.asset === price.token)
    .filter(({ condition }) => condition.kind === "price" && priceMeets(condition, whole))
    .map((alert) => ({ alert, fired }));
  if (matched.length === 0) {
    return [];
  }
  const assets = await knownAssetInfos(parts satisfies AssetSources, [price.token], { signal });
  return fireAll(parts, matched, { assets, signal });
}

/** Creates the {@link AlertFiring} over the alert store and the agent inbox it writes through. */
export function createAlertFiring(parts: AlertFiringParts): AlertFiring {
  return {
    seePrice: async (price, { signal }) => seePrice(parts, price, signal),
    async seeTrade(trade, { signal }) {
      const active = await activeOf(parts, "wallet", signal);
      const fired: AlertFire = { kind: "wallet", activity: trade.activity };
      const matched = active
        .filter(({ condition }) => condition.kind === "wallet" && tradeMatches(condition, trade))
        .map((alert) => ({ alert, fired }));
      return fireAll(parts, matched, { assets: trade.assets, signal });
    },
    async seeLaunch(launch, { signal }) {
      const active = await activeOf(parts, "launch", signal);
      const fired: AlertFire = { kind: "launch", launch: launch.launch };
      const matched = active
        .filter(
          ({ condition }) => condition.kind === "launch" && launchPasses(condition.filters, launch),
        )
        .map((alert) => ({ alert, fired }));
      return fireAll(parts, matched, { assets: launch.assets, signal });
    },
    async expire({ signal }) {
      const atMs = parts.clock.now();
      const ended = await parts.alerts.expire({ atMs, limit: expiriesPerCall }, { signal });
      return ended.length;
    },
  };
}
