import { err, type Id, idSchema, ok, type Result } from "@binference/core";
import type { OrderView, ProtocolErrorCode } from "@binference/protocol";
import { orderStates } from "@binference/protocol";
import { z } from "zod";
import { knownAssetInfos } from "../money-path/asset-infos.js";
import { type EngineCall, type EngineHandler, proposerOf } from "../operations/engine-call.js";
import { epochMsSchema } from "../records/record-fields.js";
import { cancelOrder } from "./cancel-order.js";
import { createOrder, type OrderParts } from "./create-order.js";
import type { OrderQuery, OrderRecord } from "./order-record.js";
import { orderViewOf } from "./order-view-of.js";

/** The handlers of the auto order operations the engine serves (protocol spec, section 7.5). */
export interface OrderHandlers {
  readonly "order/create": EngineHandler<"order/create">;
  readonly "order/get": EngineHandler<"order/get">;
  readonly "order/list": EngineHandler<"order/list">;
  readonly "order/cancel": EngineHandler<"order/cancel">;
}

const defaultPageSize = 50;

// A cursor is the last order of the page before: its creation time and its id, `<ms>:<id>`.
const cursorPattern = /^(0|[1-9]\d{0,14}):(.+)$/;
const createdAtSchema = z.coerce.number<string>().pipe(epochMsSchema);

function cursorOf(text: string): OrderQuery["after"] | undefined {
  const [, createdAt, id] = cursorPattern.exec(text) ?? [];
  const createdAtMs = createdAtSchema.safeParse(createdAt);
  const order = idSchema("ord").safeParse(id);
  return createdAtMs.success && order.success
    ? { createdAtMs: createdAtMs.data, id: order.data }
    : undefined;
}

function queryOf(args: EngineCall<"order/list">["args"]): Result<OrderQuery, ProtocolErrorCode> {
  const after = args.cursor === undefined ? undefined : cursorOf(args.cursor);
  if (args.cursor !== undefined && after === undefined) {
    return err("protocol.bad_args");
  }
  return ok({
    states: args.state === undefined ? [...orderStates] : [args.state],
    limit: args.limit ?? defaultPageSize,
    ...(args.agent === undefined ? {} : { agentId: args.agent }),
    ...(after === undefined ? {} : { after }),
  });
}

// An order waiting for its answer shows the card version open now.
async function viewOf(
  parts: OrderParts,
  order: OrderRecord,
  signal: AbortSignal,
): Promise<OrderView> {
  if (order.state !== "awaiting_confirmation") {
    return orderViewOf(order);
  }
  const snapshot = await parts.stored.snapshot(order.intentId, { signal });
  return orderViewOf(order, snapshot?.history.cards.at(-1)?.id);
}

async function listed(parts: OrderParts, call: EngineCall<"order/list">) {
  const query = queryOf(call.args);
  if (!query.ok) {
    return query;
  }
  const records = await parts.orders.list(query.value, { signal: call.signal });
  const tokens = [...new Set(records.map(({ request }) => request.token))];
  const last = records.at(-1);
  const page = {
    items: records.map((order) => orderViewOf(order)),
    assets: await knownAssetInfos(parts, tokens, { signal: call.signal }),
  };
  return ok(
    records.length === query.value.limit && last !== undefined
      ? { ...page, next: `${String(last.createdAtMs)}:${last.id}` }
      : page,
  );
}

/**
 * Creates the auto order handlers: `order/create` stores an order awaiting its one card and
 * answers it with that card (decision 0189); `order/get` answers one order, with its open card
 * while it waits; `order/list` pages through the orders, oldest first, in one state or all, of one
 * agent or all, with the info of each token they trade, the registry's or what its proposal
 * stored of a token the registry does not list; `order/cancel` ends an order at once, with
 * no card (`cancelOrder`).
 */
export function createOrderHandlers(parts: OrderParts): OrderHandlers {
  return {
    async "order/create"({ args, caller, signal }) {
      const proposer = proposerOf(caller);
      if (proposer === undefined) {
        return err("auth.scope");
      }
      const created = await createOrder(parts, { request: args, proposer, signal });
      if (!created.ok) {
        return created;
      }
      const card: Id<"crd"> | undefined = created.value.intent.history.cards.at(-1)?.id;
      return ok(orderViewOf(created.value.order, card));
    },
    async "order/get"({ args, signal }) {
      const order = await parts.orders.get(args.order, { signal });
      return order === undefined ? err("order.not_found") : ok(await viewOf(parts, order, signal));
    },
    "order/list": async (call) => listed(parts, call),
    async "order/cancel"({ args, caller, signal }) {
      const canceller = proposerOf(caller);
      if (canceller === undefined) {
        return err("auth.scope");
      }
      const cancelled = await cancelOrder(parts, { order: args.order, canceller, signal });
      return cancelled.ok ? ok(orderViewOf(cancelled.value)) : cancelled;
    },
  };
}
