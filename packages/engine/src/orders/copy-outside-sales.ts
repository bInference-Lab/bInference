import type { AssetRef } from "@binference/chain";
import type { Id } from "@binference/core";
import { isFillAuthorization } from "../intents/authorization.js";
import { authorizationDocument } from "../intents/intent-documents.schema.js";
import type { IntentStore, PositionStore } from "../ports.js";
import type { ExecutionRecord } from "../positions/execution-record.js";
import type { CopyOrder } from "./copy-fills.js";
import type { CopyState, ExecutionMark } from "./copy-state.js";
import type { OrderStore } from "./ports.js";

/** What a copy order reads to count the wallet's sales of a token outside the copy orders. */
export interface OutsideSaleParts {
  readonly positions: Pick<PositionStore, "executions">;
  readonly intents: Pick<IntentStore, "get">;
  readonly orders: Pick<OrderStore, "get">;
}

const executionsPerPage = 500;

// Whether an execution is a fill of a copy order: its sale took that order's own share.
async function isCopyFill(
  parts: OutsideSaleParts,
  execution: ExecutionRecord,
  signal: AbortSignal,
): Promise<boolean> {
  const intent = await parts.intents.get(execution.intentId, { signal });
  const authorizedBy =
    intent?.authorizedBy === undefined
      ? undefined
      : authorizationDocument.decode(intent.authorizedBy);
  const isFill = authorizedBy !== undefined && isFillAuthorization(authorizedBy);
  const orderId: Id<"ord"> | undefined =
    isFill && "order" in authorizedBy ? authorizedBy.order : undefined;
  const order = orderId === undefined ? undefined : await parts.orders.get(orderId, { signal });
  return order?.kind === "copy";
}

// What the wallet sold of `asset` after `seen`, its fees among it, outside the copy orders, and
// the last of its executions read, page after page.
async function outsideSince(
  parts: OutsideSaleParts,
  order: CopyOrder,
  call: { readonly asset: AssetRef; readonly seen: ExecutionMark; readonly signal: AbortSignal },
): Promise<{ readonly base: bigint; readonly seen: ExecutionMark }> {
  const { asset, seen, signal } = call;
  // A holding's first mark is its first buy's time: no execution before it counts.
  const from = seen.id === 0 ? { fromMs: seen.atMs } : {};
  const query = { isPaper: order.isPaper, walletId: order.walletId, after: seen.id, ...from };
  const page = await parts.positions.executions({ ...query, limit: executionsPerPage }, { signal });
  const last = page.at(-1);
  if (last === undefined) {
    return { base: 0n, seen };
  }
  const sales = page.filter(({ sold }) => sold.asset === asset);
  const counted = await Promise.all(
    sales.map(async (sale) =>
      (await isCopyFill(parts, sale, signal)) ? 0n : sale.sold.base + sale.feeBase,
    ),
  );
  const base = counted.reduce((sum, each) => sum + each, 0n);
  const next = { atMs: last.atMs, id: last.id };
  if (page.length < executionsPerPage) {
    return { base, seen: next };
  }
  const rest = await outsideSince(parts, order, { asset, seen: next, signal });
  return { base: base + rest.base, seen: rest.seen };
}

/**
 * The state with the order's holding of `asset` lowered by what the wallet sold of it outside the
 * copy orders since the holding was last counted, by hand, through an exit order or through any
 * other fill, never below zero (decision 0260). A copy sale then never sells the agent's own
 * tokens bought again after such a sale.
 */
export async function honestHeldState(
  parts: OutsideSaleParts,
  call: {
    readonly order: CopyOrder;
    readonly state: CopyState;
    readonly asset: AssetRef;
    readonly signal: AbortSignal;
  },
): Promise<CopyState> {
  const { order, state, asset, signal } = call;
  const holding = state.held.find((held) => held.asset === asset);
  if (holding === undefined) {
    return state;
  }
  const mark = holding.seen ?? { atMs: state.sinceMs, id: 0 };
  const outside = await outsideSince(parts, order, { asset, seen: mark, signal });
  const base = holding.base > outside.base ? holding.base - outside.base : 0n;
  const others = state.held.filter((held) => held.asset !== asset);
  const kept = base > 0n ? [{ asset, base, seen: outside.seen }] : [];
  return { ...state, held: [...others, ...kept] };
}
