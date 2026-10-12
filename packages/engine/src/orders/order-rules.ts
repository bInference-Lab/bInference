import {
  type AssetRef,
  assetRefParts,
  canonicalAsset,
  type ChainRegistry,
  type RegisteredChain,
} from "@binference/chain";
import { bpsPerWhole, err, ok, type Result } from "@binference/core";
import type { OrderRequest } from "@binference/protocol";
import { nativeAssetOf } from "../money-path/resolve-proposal.js";

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

/** Why an order request was refused before anything was stored (decision 0189). */
type OrderRuleRefusal = "protocol.bad_args" | "order.kind_unavailable";

type Checked<T> = Result<T, OrderRuleRefusal>;

const badArgs = err("protocol.bad_args");

// The kinds a price triggers; DCA and copy orders wait for their watchers (decision 0189).
const priceKinds: ReadonlySet<OrderRequest["kind"]> = new Set([
  "limit",
  "takeProfit",
  "stopLoss",
  "trailing",
]);

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

// A buy takes its size in dollars; a sale in base units, dollars or a share of what it holds.
function isSizeValid(request: OrderRequest): boolean {
  const { size } = request;
  if ("usdMicros" in size) {
    return size.usdMicros > 0n;
  }
  if (request.side === "buy") {
    return false;
  }
  return "base" in size ? size.base > 0n : size.percentBps > 0 && size.percentBps <= bpsPerWhole;
}

// A price above zero; a trailing distance above 0 and below 100%. DCA and copy never get here.
function isTriggerValid(request: OrderRequest): boolean {
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
    (request.side === "sell" || !sellingKinds.has(request.kind))
  );
}

// One fill by default for a limit, take-profit or stop-loss order; none for a trailing stop.
function maxFillsOf(request: OrderRequest): number | undefined {
  return request.maxFills ?? (request.kind === "trailing" ? undefined : 1);
}

/**
 * Checks an `order/create` request against the rules of decision 0189 and fills its defaults: an
 * expiry 30 days after `nowMs` and one fill for a limit, take-profit or stop-loss order. A DCA or
 * copy order is `order.kind_unavailable`; any other broken rule `protocol.bad_args`.
 */
export function checkOrderRequest(
  request: OrderRequest,
  context: { readonly nowMs: number; readonly chains: ChainRegistry },
): Checked<CheckedOrder> {
  if (!priceKinds.has(request.kind)) {
    return err("order.kind_unavailable");
  }
  const found = tokenOf(request, context.chains);
  const isValid =
    isSizeValid(request) && isTriggerValid(request) && areBoundsValid(request, context.nowMs);
  if (!found.ok || !isValid) {
    return badArgs;
  }
  const expiresAtMs = request.expiresAt ?? context.nowMs + defaultOrderLifetimeMs;
  const maxFills = maxFillsOf(request);
  const filled = {
    ...request,
    token: found.value.token,
    expiresAt: expiresAtMs,
    ...(maxFills === undefined ? {} : { maxFills }),
  };
  return ok({
    request: filled,
    expiresAtMs,
    ...(maxFills === undefined ? {} : { maxFills }),
    chain: found.value.chain,
  });
}
