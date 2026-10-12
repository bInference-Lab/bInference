import type { AssetRef, ChainRegistry, RegisteredChain, Signer } from "@binference/chain";
import {
  BinferenceError,
  type Clock,
  err,
  type Id,
  type IdSource,
  ok,
  type Result,
} from "@binference/core";
import type { AssetInfos, OrderRequest, ProtocolErrorCode } from "@binference/protocol";
import type { AgentSettings } from "../agents/agent-record.js";
import type { IntentSnapshot, StoredIntents } from "../intents/create-stored-intents.js";
import { createIntentStateMachine } from "../intents/state-machine.js";
import type { Proposer } from "../money-path/create-money-path.js";
import { openCardUnchecked } from "../money-path/open-card-unchecked.js";
import { type ReadTokenFacts, unlistedAssetInfos } from "../money-path/token-facts.js";
import type { AgentStore, WalletFactsSource } from "../ports.js";
import type { PublishPush } from "../pushes/engine-push.js";
import { autoOrderQuoteDocument } from "./auto-order-quote.js";
import {
  hasPriceTrigger,
  isExitOrder,
  type OrderDraft,
  type OrderRecord,
  positionOf,
} from "./order-record.js";
import { checkOrderRequest, type CheckedOrder } from "./order-rules.js";
import { orderPush } from "./order-view-of.js";
import type { OrderStore } from "./ports.js";

/** What the orders use cases read and write through, and where their pushes go. */
export interface OrderParts {
  readonly orders: OrderStore;
  readonly stored: StoredIntents;
  readonly agents: AgentStore;
  /** Which wallets each agent owns, its default first. */
  readonly wallets: Pick<WalletFactsSource, "wallets">;
  /** Custody, which holds each wallet's account on each chain. */
  readonly custody: Pick<Signer, "account">;
  readonly chains: ChainRegistry;
  readonly clock: Clock;
  readonly ids: IdSource;
  readonly publish: PublishPush;
  /** Whether the engine is locked: the auto test reads it, and an order's card asks either way. */
  readonly isLocked: () => boolean;
  /** The card timer: closes an intent's card as expired once its time is up. */
  readonly expireCard: (intent: Id<"int">, call: { readonly signal: AbortSignal }) => Promise<void>;
  /** Whether the price watcher can price a token now (decision 0194). */
  readonly canPrice: CanPrice;
  /** Reads what a token the registry does not list answers on chain, for the order's card. */
  readonly readTokenFacts: ReadTokenFacts;
  /** Whether a live order may fill; while it may not, no live price order is taken (decision 0197). */
  readonly liveFills: boolean;
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

// A live price order would never fill while live fills are off, so none is taken (decision 0197).
function liveRefusal(
  parts: Pick<OrderParts, "liveFills">,
  call: { readonly settings: AgentSettings; readonly request: OrderRequest },
): ProtocolErrorCode | undefined {
  const isLive = call.settings.agent.mode === "live";
  return isLive && hasPriceTrigger(call.request.kind) && !parts.liveFills
    ? "order.live_fills_off"
    : undefined;
}

// The request's wallet, or the agent's default one, with an account in custody on the token's
// chain.
async function walletOf(
  parts: Pick<OrderParts, "wallets" | "custody">,
  asked: { readonly request: OrderRequest; readonly chain: RegisteredChain },
  signal: AbortSignal,
): Promise<Id<"wal"> | undefined> {
  const { request, chain } = asked;
  const owned = await parts.wallets.wallets(request.agent, { signal });
  const wallet = request.wallet ?? owned[0];
  if (wallet === undefined || !owned.includes(wallet)) {
    return undefined;
  }
  const account = await parts.custody.account(wallet, chain.ref, { signal });
  return account.ok ? wallet : undefined;
}

/** The wallet that holds a new order, and what its unlisted tokens answered on chain. */
interface Holder {
  readonly wallet: Id<"wal">;
  readonly assets: AssetInfos;
}

// The wallet that holds the order; a price order also needs a token the price watcher can price,
// and a token the registry does not list must answer its symbol and decimals for the card.
async function holderOf(
  parts: Pick<OrderParts, "wallets" | "custody" | "canPrice" | "chains" | "readTokenFacts">,
  checked: CheckedOrder,
  signal: AbortSignal,
): Promise<Result<Holder, ProtocolErrorCode>> {
  const wallet = await walletOf(parts, checked, signal);
  if (wallet === undefined) {
    return err("wallet.not_found");
  }
  const { request } = checked;
  if (hasPriceTrigger(request.kind) && !(await parts.canPrice(request.token, { signal }))) {
    return err("order.unpriced_token");
  }
  const { token, spend } = request;
  const named = spend === undefined ? [token] : [token, spend];
  const assets = await unlistedAssetInfos(parts, named, signal);
  return assets.ok ? ok({ wallet, assets: assets.value }) : assets;
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
  const machine = createIntentStateMachine({ clock: parts.clock });
  const step = machine.propose({
    kind: "autoOrder",
    proposer: proposer.role,
    isPaper: order.isPaper,
    hasOutsideContent: order.hasOutsideContent,
    agentStatus: "active",
  });
  const intent = {
    id: order.intentId,
    agentId: order.agentId,
    walletId: order.walletId,
    proposerRef: proposer.ref,
    request: { kind: "autoOrder", order: order.id } as const,
    ...(Object.keys(assets).length === 0 ? {} : { assets }),
  };
  const created = step.ok
    ? await parts.stored.create({ ...intent, step: step.value }, { signal })
    : undefined;
  if (created?.ok !== true) {
    throw new BinferenceError({
      code: "engine.order_not_stored",
      message: `The card of auto order ${order.id} could not be stored.`,
      details: { order: order.id },
    });
  }
  const quotedAtMs = parts.clock.now();
  const quote = autoOrderQuoteDocument.encode({
    order: order.id,
    request: order.request,
    expiresAtMs: order.expiresAtMs,
    ...(order.maxFills === undefined ? {} : { maxFills: order.maxFills }),
    hasLinkedExits: opening.hasLinkedExits,
    quotedAtMs,
  });
  const advance = { stored: parts.stored, machine, signal };
  const run = { proposed: created.value, quote, quotedAtMs, isLocked: parts.isLocked() };
  return openCardUnchecked(advance, run);
}

/**
 * Creates an auto order (decision 0189): checks the request and fills its defaults, stores the
 * order `awaiting_confirmation` in its agent's mode with the proposal's outside-content mark, then
 * its `autoOrder` intent, which always opens one card, whatever the mode or the mark. The order
 * becomes `active` only on that card's Confirm. A refusal stores nothing: an unknown, archived or
 * frozen agent, a wallet that is not the agent's, a kind that does not run yet, a broken rule, or
 * a price order for a token the price watcher cannot price now (decision 0194), or a token the
 * registry does not list that answers no symbol or decimals on chain (`asset.unreadable`,
 * decision 0199). The card shows such a token by what it answered, marked unverified.
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
  const checked = checkOrderRequest(request, { nowMs: parts.clock.now(), chains: parts.chains });
  if (!checked.ok) {
    return checked;
  }
  const settings = await parts.agents.get(request.agent, { signal });
  const refusal = agentRefusal(settings);
  if (refusal !== undefined || settings === undefined) {
    return err(refusal ?? "agent.not_found");
  }
  const offLive = liveRefusal(parts, { settings, request });
  if (offLive !== undefined) {
    return err(offLive);
  }
  const held = await holderOf(parts, checked.value, signal);
  if (!held.ok) {
    return held;
  }
  const { wallet, assets } = held.value;
  const draft = draftOf(parts, checked.value, { wallet, settings, proposer });
  const isLinked = await hasLinkedExits(parts, draft, signal);
  const created = await parts.orders.create(draft, { signal });
  if (!created.ok && created.error === "frozen") {
    return err("agent.frozen");
  }
  if (!created.ok) {
    throw new BinferenceError({
      code: "engine.order_not_stored",
      message: `A new auto order's id ${draft.id} is taken.`,
      details: { order: draft.id },
    });
  }
  parts.publish(orderPush(created.value, "order/created"));
  const order = { order: created.value, proposer, hasLinkedExits: isLinked, assets };
  const intent = await openOrderCard(parts, order, signal);
  return ok({ order: created.value, intent });
}
