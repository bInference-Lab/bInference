import {
  type AssetRef,
  assetRefParts,
  canonicalAsset,
  type ChainRegistry,
  type RegisteredChain,
} from "@binference/chain";
import { bpsPerWhole, err, ok, type Result } from "@binference/core";
import type { CopyOrderRequest, DcaOrderRequest, OrderRequest } from "@binference/protocol";
import { assetInfoOf } from "../money-path/asset-infos.js";
import { nativeAssetOf } from "../money-path/resolve-proposal.js";
import { nextRunOf } from "../schedules/schedule-times.js";
import { checkCopyRequest } from "./copy-rules.js";

/** How long an order lasts when its request names no expiry: 30 days (spec 1, section 8.2). */
export const defaultOrderLifetimeMs = 2_592_000_000;

/** An order request that passed its rules, with every default filled and its token canonical. */
export interface CheckedOrder {
  readonly request: OrderRequest;
  readonly expiresAtMs: number;
  /** Absent: no limit on its fills. */
  readonly maxFills?: number;
  readonly chain: RegisteredChain;
}

/** Why an order request was refused before anything was stored (decisions 0189 and 0246). */
type OrderRuleRefusal = "protocol.bad_args" | "schedule.bad_when";

type Checked<T> = Result<T, OrderRuleRefusal>;

const badArgs = err("protocol.bad_args");

// Take-profit, stop-loss and trailing orders sell; a limit order may buy or sell.
const sellingKinds: ReadonlySet<OrderRequest["kind"]> = new Set([
  "takeProfit",
  "stopLoss",
  "trailing",
]);

// The token on a chain of the registry, in its canonical form, and never the chain's own coin.
function tokenOf(
  request: OrderRequest,
  chains: ChainRegistry,
): Checked<{ readonly token: AssetRef; readonly chain: RegisteredChain }> {
  const chain = chains.get(assetRefParts(request.token).chain);
  const token = canonicalAsset(chains, request.token);
  if (!chain.ok || !token.ok || token.value === nativeAssetOf(chain.value)) {
    return badArgs;
  }
  return ok({ token: token.value, chain: chain.value });
}

// A size in dollars, in base units or as a share above 0 and at most 100% (decision 0190): a buy's
// counts what it spends, a sale's what it sells.
function isSizeValid(request: OrderRequest): boolean {
  const { size } = request;
  if ("usdMicros" in size) {
    return size.usdMicros > 0n;
  }
  return "base" in size ? size.base > 0n : size.percentBps > 0 && size.percentBps <= bpsPerWhole;
}

// What a buy spends, in its canonical form: the chain's coin when the request names none, else a
// token the registry lists on the token's own chain, never the token it buys. A sale spends none.
function spendOf(
  request: OrderRequest,
  found: { readonly token: AssetRef; readonly chain: RegisteredChain },
  chains: ChainRegistry,
): Checked<AssetRef | undefined> {
  const { spend } = request;
  if (request.side === "sell") {
    return spend === undefined ? ok(undefined) : badArgs;
  }
  const coin = nativeAssetOf(found.chain);
  if (spend === undefined) {
    return ok(coin);
  }
  const canonical = canonicalAsset(chains, spend);
  if (!canonical.ok || canonical.value === found.token) {
    return badArgs;
  }
  const isListed =
    canonical.value === coin ||
    (assetRefParts(canonical.value).chain === found.chain.ref &&
      assetInfoOf(chains, canonical.value) !== undefined);
  return isListed ? ok(canonical.value) : badArgs;
}

// A price above zero; a trailing distance above 0 and below 100%. A DCA order's period and a copy
// order's terms are checked apart.
function isTriggerValid(request: Exclude<OrderRequest, CopyOrderRequest>): boolean {
  if (request.kind === "dca") {
    return true;
  }
  if (request.kind === "trailing") {
    const { distanceBps } = request.trigger;
    return distanceBps > 0 && distanceBps < bpsPerWhole;
  }
  return "price" in request.trigger && request.trigger.price > 0n;
}

function areBoundsValid(request: OrderRequest, nowMs: number): boolean {
  const { worstPrice, expiresAt } = request;
  return (
    (worstPrice === undefined || worstPrice > 0n) &&
    (expiresAt === undefined || expiresAt > nowMs) &&
    (request.side === "sell" || !sellingKinds.has(request.kind)) &&
    (request.side === "buy" || request.kind !== "dca")
  );
}

// A limit or take-profit order trades no worse than its trigger price unless the request names
// a worst price of its own (decision 0197); a stop-loss or a trailing stop, which must sell, none.
function worstPriceOf(request: OrderRequest): bigint | undefined {
  const isLevelOrder = request.kind === "limit" || request.kind === "takeProfit";
  return request.worstPrice ?? (isLevelOrder ? request.trigger.price : undefined);
}

// One fill unless the request names more, for every kind a price triggers (decision 0197). A DCA
// order buys `count` times, or until it ends when it names no count (decision 0246); a copy order
// copies until it ends unless it names a most (decision 0261).
function maxFillsOf(request: OrderRequest): number | undefined {
  if (request.kind === "copy") {
    return request.maxFills;
  }
  return request.kind === "dca"
    ? (request.trigger.count ?? request.maxFills)
    : (request.maxFills ?? 1);
}

/** The time a DCA order's buys run on, and the zone it was not given: the owner's (0246). */
interface DcaContext {
  readonly nowMs: number;
  readonly ownerZone: string;
}

// A DCA order's period in its own zone, else the owner's, filled in so its card binds it: five
// cron fields with a run ahead, and a count its `maxFills`, if both are named, agrees with.
function dcaOf(request: DcaOrderRequest, context: DcaContext): Checked<DcaOrderRequest> {
  const { trigger, maxFills } = request;
  if (trigger.count !== undefined && maxFills !== undefined && maxFills !== trigger.count) {
    return badArgs;
  }
  const timezone = trigger.timezone ?? context.ownerZone;
  const next = nextRunOf({ cron: trigger.cron, timezone }, context.nowMs, context.ownerZone);
  return next.ok && next.value !== undefined
    ? ok({ ...request, trigger: { ...trigger, timezone } })
    : err("schedule.bad_when");
}

// The order with every default filled, its token and what it spends in their canonical forms.
function filledOrder(
  request: OrderRequest,
  found: {
    readonly token: AssetRef;
    readonly spend: AssetRef | undefined;
    readonly chain: RegisteredChain;
  },
  nowMs: number,
): CheckedOrder {
  const expiresAtMs = request.expiresAt ?? nowMs + defaultOrderLifetimeMs;
  const most = maxFillsOf(request);
  const limit = most === undefined ? {} : { maxFills: most };
  const spend = found.spend === undefined ? {} : { spend: found.spend };
  const worst = worstPriceOf(request);
  const worstPrice = worst === undefined ? {} : { worstPrice: worst };
  const filled = {
    ...request,
    token: found.token,
    ...spend,
    ...worstPrice,
    expiresAt: expiresAtMs,
    ...limit,
  };
  return { request: filled, expiresAtMs, ...limit, chain: found.chain };
}

// A copy order's terms (decision 0261), with its expiry and most fills filled as any order's.
function copyOf(
  request: CopyOrderRequest,
  nowMs: number,
  chains: ChainRegistry,
): Checked<CheckedOrder> {
  const copy = checkCopyRequest(request, chains);
  if (!copy.ok || (request.expiresAt !== undefined && request.expiresAt <= nowMs)) {
    return badArgs;
  }
  const { token, spend } = copy.value.request;
  return ok(filledOrder(copy.value.request, { token, spend, chain: copy.value.chain }, nowMs));
}

/**
 * Checks an `order/create` request against the rules of decisions 0189, 0190, 0246 and 0261 and
 * fills its defaults: an expiry 30 days after `nowMs`, one fill for a price order that names no
 * more, a limit or take-profit order's trigger price as its worst price (decision 0197), the
 * chain's coin as what a buy spends, a DCA order's zone, `ownerZone` (`owner.timezone` now),
 * unless it names one, and a copy order's leader in its canonical form.
 * A DCA period binference cannot read, or with no run ahead, is `schedule.bad_when`; any other
 * broken rule `protocol.bad_args`, a DCA sale among them.
 */
export function checkOrderRequest(
  given: OrderRequest,
  context: { readonly nowMs: number; readonly chains: ChainRegistry; readonly ownerZone: string },
): Checked<CheckedOrder> {
  if (given.kind === "copy") {
    return copyOf(given, context.nowMs, context.chains);
  }
  const dca =
    given.kind === "dca"
      ? dcaOf(given, { nowMs: context.nowMs, ownerZone: context.ownerZone })
      : ok(given);
  if (!dca.ok) {
    return dca;
  }
  const request = dca.value;
  const found = tokenOf(request, context.chains);
  const isValid =
    isSizeValid(request) && isTriggerValid(request) && areBoundsValid(request, context.nowMs);
  if (!found.ok || !isValid) {
    return badArgs;
  }
  const spend = spendOf(request, found.value, context.chains);
  return spend.ok
    ? ok(filledOrder(request, { ...found.value, spend: spend.value }, context.nowMs))
    : spend;
}
