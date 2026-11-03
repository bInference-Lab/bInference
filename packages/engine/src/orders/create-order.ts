import type { AssetRef } from "@binference/chain";
import { type BinferenceErrorOptions, err, type Id, ok, type Result } from "@binference/core";
import type { AssetInfos, OrderRequest, ProtocolErrorCode } from "@binference/protocol";
import type { AgentSettings } from "../agents/agent-record.js";
import type { IntentSnapshot } from "../intents/create-stored-intents.js";
import type { Proposer } from "../money-path/create-money-path.js";
import { unlistedAssetInfos } from "../money-path/token-facts.js";
import { autoOrderQuoteDocument } from "./auto-order-quote.js";
import { isInstallAccount } from "./install-accounts.js";
import { type OneCardParts, openOneCard, storedUnlessTaken } from "./open-one-card.js";
import {
  hasPriceTrigger,
  isExitOrder,
  type OrderDraft,
  type OrderRecord,
  positionOf,
} from "./order-record.js";
import { checkOrderRequest, type CheckedOrder } from "./order-rules.js";
import { orderPush } from "./order-view-of.js";
import { orderWalletOf } from "./order-wallet-of.js";
import type { OrderStore } from "./ports.js";

/**
 * What the orders use cases read and write through, and where their pushes go. No copy order may
 * follow a wallet of the install (decision 0261).
 */
export interface OrderParts extends OneCardParts {
  readonly orders: OrderStore;
  /** Whether the price watcher can price a token now (decision 0194). */
  readonly canPrice: CanPrice;
  /**
   * Whether a live order may fill; while it may not, no live price or DCA order is taken
   * (decisions 0197 and 0246).
   */
  readonly liveFills: boolean;
  /** `owner.timezone` now: a DCA order that names no zone runs on the owner's (decision 0246). */
  readonly ownerTimeZone: () => string;
}

/**
 * Whether the price watcher can price a token now: a venue's read of it, or a pool deep enough.
 * Rejects with the signal's reason once it aborts.
 */
export type CanPrice = (
  token: AssetRef,
  call: { readonly signal: AbortSignal },
) => Promise<boolean>;

/** A new order with the `autoOrder` intent that carries its card. */
export interface CreatedOrder {
  readonly order: OrderRecord;
  readonly intent: IntentSnapshot;
}

// The agent must exist, be in use and not be frozen: a frozen agent takes no order.
function agentRefusal(settings: AgentSettings | undefined): ProtocolErrorCode | undefined {
  if (settings === undefined) {
    return "agent.not_found";
  }
  if (settings.agent.archivedAtMs !== undefined) {
    return "agent.archived";
  }
  return settings.agent.frozenAtMs === undefined ? undefined : "agent.frozen";
}

// A live order would never fill while live fills are off, so none is taken: a price order
// (decision 0197), a DCA order (decision 0246) or a copy order (decision 0261).
function liveRefusal(
  parts: Pick<OrderParts, "liveFills">,
  call: { readonly settings: AgentSettings },
): ProtocolErrorCode | undefined {
  const isLive = call.settings.agent.mode === "live";
  return isLive && !parts.liveFills ? "order.live_fills_off" : undefined;
}

/** The wallet that holds a new order, and what its unlisted tokens answered on chain. */
interface Holder {
  readonly wallet: Id<"wal">;
  readonly assets: AssetInfos;
}

// The wallet that holds the order; a price order also needs a token the price watcher can price,
// and a token the registry does not list must answer its symbol and decimals for the card.
async function holderOf(
  parts: Pick<
    OrderParts,
    "wallets" | "custody" | "canPrice" | "chains" | "readTokenFacts" | "launches" | "install"
  >,
  checked: CheckedOrder & { readonly isPaper: boolean },
  signal: AbortSignal,
): Promise<Result<Holder, ProtocolErrorCode>> {
  const holder = await orderWalletOf(parts, checked, signal);
  if (!holder.ok) {
    return holder;
  }
  const wallet = holder.value;
  const { request } = checked;
  if (hasPriceTrigger(request.kind) && !(await parts.canPrice(request.token, { signal }))) {
    return err("order.unpriced_token");
  }
  const { token, spend } = request;
  const named = spend === undefined ? [token] : [token, spend];
  const assets = await unlistedAssetInfos(parts, named, signal);
  return assets.ok ? ok({ wallet, assets: assets.value }) : assets;
}

// Whether a copy order's leader is an account of one of the agent's own wallets, or of any other
// wallet of the install: its copies would be leader trades in turn (decision 0261).
async function followsTheInstall(
  parts: Pick<OrderParts, "wallets" | "custody" | "install" | "chains">,
  checked: CheckedOrder,
  signal: AbortSignal,
): Promise<boolean> {
  const { request, chain } = checked;
  if (request.kind !== "copy") {
    return false;
  }
  const owned = await parts.wallets.wallets(request.agent, { signal });
  const accounts = await Promise.all(
    owned.map(async (wallet) => parts.custody.account(wallet, chain.ref, { signal })),
  );
  const { leader } = request.trigger;
  const isOwn = accounts.some((account) => account.ok && account.value === leader);
  return isOwn || (await isInstallAccount(parts, leader, signal));
}

// Whether the position of a new exit order holds another exit order that has not ended.
async function hasLinkedExits(
  parts: Pick<OrderParts, "orders">,
  draft: OrderDraft,
  signal: AbortSignal,
): Promise<boolean> {
  if (!isExitOrder(draft.request)) {
    return false;
  }
  const position = positionOf(draft);
  const query = { states: ["active", "paused"] as const, walletId: draft.walletId, limit: 1_000 };
  const running = await parts.orders.list({ ...query, isPaper: draft.isPaper }, { signal });
  return running.some(
    (order) => order.request.token === position.token && isExitOrder(order.request),
  );
}

function draftOf(
  parts: Pick<OrderParts, "ids" | "clock">,
  checked: CheckedOrder,
  owner: {
    readonly wallet: Id<"wal">;
    readonly settings: AgentSettings;
    readonly proposer: Proposer;
  },
): OrderDraft {
  const { request, expiresAtMs, maxFills } = checked;
  return {
    id: parts.ids.next("ord"),
    agentId: request.agent,
    walletId: owner.wallet,
    request: { ...request, wallet: owner.wallet },
    ...(maxFills === undefined ? {} : { maxFills }),
    expiresAtMs,
    intentId: parts.ids.next("int"),
    isPaper: owner.settings.agent.mode === "paper",
    hasOutsideContent: owner.proposer.hasOutsideContent,
    atMs: parts.clock.now(),
  };
}

// Stores the order's `autoOrder` intent and takes it to its one card: its quote holds the order's
// terms, so the card's terms hash binds them (decision 0189).
async function openOrderCard(
  parts: OrderParts,
  opening: {
    readonly order: OrderRecord;
    readonly proposer: Proposer;
    readonly hasLinkedExits: boolean;
    readonly assets: AssetInfos;
  },
  signal: AbortSignal,
): Promise<IntentSnapshot> {
  const { order, proposer, assets } = opening;
  const quoteAt = (quotedAtMs: number) =>
    autoOrderQuoteDocument.encode({
      order: order.id,
      request: order.request,
      expiresAtMs: order.expiresAtMs,
      ...(order.maxFills === undefined ? {} : { maxFills: order.maxFills }),
      hasLinkedExits: opening.hasLinkedExits,
      quotedAtMs,
    });
  const notStored: BinferenceErrorOptions = {
    code: "engine.order_not_stored",
    message: `The card of auto order ${order.id} could not be stored.`,
    details: { order: order.id },
  };
  const request = { kind: "autoOrder", order: order.id } as const;
  const card = { record: order, request, proposer, assets, quoteAt, notStored };
  return openOneCard(parts, card, signal);
}

// What the order rules read: the time, the registry and the owner's zone now.
function rulesContextOf(parts: Pick<OrderParts, "clock" | "chains" | "ownerTimeZone">) {
  return { nowMs: parts.clock.now(), chains: parts.chains, ownerZone: parts.ownerTimeZone() };
}

// A stored order, or why the store refused it: a frozen agent, or a 51st tracked wallet. An id in
// use is a fault.
function storedOrder(
  created: Result<OrderRecord, "exists" | "frozen" | "track_limit">,
  draft: OrderDraft,
): Result<OrderRecord, "agent.frozen" | "wallet.track_limit"> {
  const stored = storedUnlessTaken(created, {
    code: "engine.order_not_stored",
    message: `A new auto order's id ${draft.id} is taken.`,
    details: { order: draft.id },
  });
  return stored.ok
    ? stored
    : err(stored.error === "frozen" ? "agent.frozen" : "wallet.track_limit");
}

/**
 * Creates an auto order (decision 0189): checks the request and fills its defaults, stores the
 * order `awaiting_confirmation` in its agent's mode with the proposal's outside-content mark, then
 * its `autoOrder` intent, which always opens one card, whatever the mode or the mark. The order
 * becomes `active` only on that card's Confirm. A refusal stores nothing: an unknown, archived or
 * frozen agent, a wallet that is not the agent's, a launchpad whose curve read failed as it picks
 * the wallet (`quote.venue_down`), a broken rule, a copy order of a wallet of the install, or
 * a price order for a token the price watcher cannot price now (decision 0194), or a token the
 * registry does not list that answers no symbol or decimals on chain (`asset.unreadable`,
 * decision 0199), or a copy order whose leader would be the 51st tracked wallet
 * (`wallet.track_limit`). The card shows such a token by what it answered, marked unverified.
 */
export async function createOrder(
  parts: OrderParts,
  call: {
    readonly request: OrderRequest;
    readonly proposer: Proposer;
    readonly signal: AbortSignal;
  },
): Promise<Result<CreatedOrder, ProtocolErrorCode>> {
  const { request, proposer, signal } = call;
  const checked = checkOrderRequest(request, rulesContextOf(parts));
  if (!checked.ok) {
    return checked;
  }
  const settings = await parts.agents.get(request.agent, { signal });
  const refusal = agentRefusal(settings);
  if (refusal !== undefined || settings === undefined) {
    return err(refusal ?? "agent.not_found");
  }
  const offLive = liveRefusal(parts, { settings });
  if (offLive !== undefined) {
    return err(offLive);
  }
  if (await followsTheInstall(parts, checked.value, signal)) {
    return err("protocol.bad_args");
  }
  const isPaper = settings.agent.mode === "paper";
  const held = await holderOf(parts, { ...checked.value, isPaper }, signal);
  if (!held.ok) {
    return held;
  }
  const { wallet, assets } = held.value;
  const draft = draftOf(parts, checked.value, { wallet, settings, proposer });
  const isLinked = await hasLinkedExits(parts, draft, signal);
  const created = storedOrder(await parts.orders.create(draft, { signal }), draft);
  if (!created.ok) {
    return created;
  }
  parts.publish(orderPush(created.value, "order/created"));
  const order = { order: created.value, proposer, hasLinkedExits: isLinked, assets };
  const intent = await openOrderCard(parts, order, signal);
  return ok({ order: created.value, intent });
}
