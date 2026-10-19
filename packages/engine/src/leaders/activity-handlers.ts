import type { AccountRef, ChainRegistry } from "@binference/chain";
import { err, type Id, ok, type Result } from "@binference/core";
import type { ProtocolErrorCode, ResultOf } from "@binference/protocol";
import { z } from "zod";
import { maxActiveAlerts } from "../alerts/alert-record.js";
import type { AlertStore } from "../alerts/ports.js";
import { assetInfosOf } from "../money-path/asset-infos.js";
import { activeAgent } from "../operations/active-agent.js";
import { canonicalAccount } from "../operations/canonical-account.js";
import type { EngineCall, EngineHandler } from "../operations/engine-call.js";
import { copyLeaderOf, trackingOrderStates } from "../orders/copy-leader.js";
import type { OrderStore } from "../orders/ports.js";
import type { AgentStore } from "../ports.js";
import { epochMsSchema, rowNumberSchema } from "../records/record-fields.js";
import { activityItemOf } from "./activity-item-of.js";
import type { TrackedWalletStore } from "./ports.js";
import type { StoredActivity } from "./tracked-wallet-record.js";

/** The handler of `wallet/activity` (protocol spec, section 7.3). */
export interface ActivityHandlers {
  readonly "wallet/activity": EngineHandler<"wallet/activity">;
}

/** What `wallet/activity` reads: the tracked wallets' trades, and what makes an agent track one. */
export interface ActivityHandlersOptions {
  readonly trackedWallets: Pick<TrackedWalletStore, "activity">;
  readonly alerts: Pick<AlertStore, "list">;
  readonly orders: Pick<OrderStore, "list">;
  readonly agents: AgentStore;
  readonly chains: ChainRegistry;
}

const defaultPageSize = 50;
// An agent's copy orders are read in pages this large to find one that follows the account.
const ordersPerPage = 200;

// A cursor is the last trade of the page before: its time and its number, `<ms>:<number>`.
const cursorPattern = /^(0|[1-9]\d{0,14}):([1-9]\d{0,15})$/;
const cursorSchema = z.tuple([
  z.coerce.number<string>().pipe(epochMsSchema),
  z.coerce.number<string>().pipe(rowNumberSchema),
]);

function beforeOf(cursor: string): { readonly atMs: number; readonly id: number } | undefined {
  const [, atMs, id] = cursorPattern.exec(cursor) ?? [];
  const parsed = cursorSchema.safeParse([atMs, id]);
  return parsed.success ? { atMs: parsed.data[0], id: parsed.data[1] } : undefined;
}

// Whether the agent tracks the account: an active wallet alert of it, or a live copy order.
async function isTrackedBy(
  options: ActivityHandlersOptions,
  watch: { readonly agentId: Id<"agt">; readonly account: AccountRef },
  signal: AbortSignal,
): Promise<boolean> {
  const { agentId, account } = watch;
  const alerts = await options.alerts.list(
    { states: ["active"], agentId, kind: "wallet", limit: maxActiveAlerts },
    { signal },
  );
  if (
    alerts.some(({ condition }) => condition.kind === "wallet" && condition.account === account)
  ) {
    return true;
  }
  const orders = await options.orders.list(
    { states: trackingOrderStates, agentId, limit: ordersPerPage },
    { signal },
  );
  return orders.some(({ request }) => copyLeaderOf(request) === account);
}

interface ActivityCall {
  readonly account: AccountRef;
  readonly before?: { readonly atMs: number; readonly id: number };
}

// The call's account in its canonical form and where its page starts, while the agent is in use
// and tracks the account.
async function checkedCall(
  options: ActivityHandlersOptions,
  call: EngineCall<"wallet/activity">,
): Promise<Result<ActivityCall, ProtocolErrorCode>> {
  const { args, signal } = call;
  const agent = await activeAgent(options.agents, args.agent, { signal });
  if (!agent.ok) {
    return agent;
  }
  const account = canonicalAccount(options.chains, args.account);
  const before = args.cursor === undefined ? undefined : beforeOf(args.cursor);
  if (!account.ok || (before === undefined && args.cursor !== undefined)) {
    return err("protocol.bad_args");
  }
  const watch = { agentId: args.agent, account: account.value };
  if (!(await isTrackedBy(options, watch, signal))) {
    return err("wallet.not_found");
  }
  return ok({ account: account.value, ...(before === undefined ? {} : { before }) });
}

function pageOf(
  chains: ChainRegistry,
  trades: readonly StoredActivity[],
  limit: number,
): ResultOf<"wallet/activity"> {
  const last = trades.at(-1);
  const isFull = trades.length === limit && last !== undefined;
  const assets = [...new Set(trades.flatMap(({ asset, counterAsset }) => [asset, counterAsset]))];
  return {
    items: trades.map(activityItemOf),
    ...(isFull ? { next: `${String(last.atMs)}:${String(last.id)}` } : {}),
    assets: assetInfosOf(chains, assets),
  };
}

async function activityOf(
  options: ActivityHandlersOptions,
  call: EngineCall<"wallet/activity">,
): Promise<Result<ResultOf<"wallet/activity">, ProtocolErrorCode>> {
  const checked = await checkedCall(options, call);
  if (!checked.ok) {
    return checked;
  }
  const { args, signal } = call;
  const limit = args.limit ?? defaultPageSize;
  const query = {
    ...checked.value,
    limit,
    ...(args.from === undefined ? {} : { fromMs: args.from }),
    ...(args.to === undefined ? {} : { toMs: args.to }),
  };
  const trades = await options.trackedWallets.activity(query, { signal });
  return ok(pageOf(options.chains, trades, limit));
}

/**
 * Creates the `wallet/activity` handler. It answers an account's trades the leader watcher stored
 * since the install tracked it (decisions 0249 and 0250), newest first, a page at a time, while the
 * agent tracks it: an active wallet alert of the agent names it, or a copy order of the agent
 * awaiting its card, active or paused follows it. Any other account is `wallet.not_found`: the
 * engine reads no history it did not watch. An unknown or archived agent is `agent.not_found` or
 * `agent.archived`; an account the registry's chains cannot read, or a cursor this engine did not
 * write, `protocol.bad_args`. Each token shows by the registry's info when it lists the token.
 */
export function createActivityHandlers(options: ActivityHandlersOptions): ActivityHandlers {
  return { "wallet/activity": async (call) => activityOf(options, call) };
}
