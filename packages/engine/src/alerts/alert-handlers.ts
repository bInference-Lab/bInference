import type { ChainRegistry } from "@binference/chain";
import { type Clock, err, type IdSource, ok, type Result } from "@binference/core";
import {
  alertStates,
  type AlertView,
  type ProtocolErrorCode,
  type ResultOf,
} from "@binference/protocol";
import type { Proposer } from "../money-path/create-money-path.js";
import { activeAgent } from "../operations/active-agent.js";
import { type EngineCall, type EngineHandler, proposerOf } from "../operations/engine-call.js";
import { nextCursorOf, pageAfterOf } from "../operations/page-cursor.js";
import type { AgentStore } from "../ports.js";
import type { AlertQuery, AlertRecord } from "./alert-record.js";
import { checkAlertRequest } from "./alert-rules.js";
import { alertViewOf } from "./alert-view-of.js";
import type { AlertStore } from "./ports.js";

/** The handlers of the alert operations (protocol spec, section 7.5). */
export interface AlertHandlers {
  readonly "alert/create": EngineHandler<"alert/create">;
  readonly "alert/list": EngineHandler<"alert/list">;
  readonly "alert/delete": EngineHandler<"alert/delete">;
}

/** What the alert handlers read and write through. */
export interface AlertHandlersOptions {
  readonly alerts: AlertStore;
  readonly agents: AgentStore;
  readonly chains: ChainRegistry;
  /** Whether a venue this engine runs is a launchpad, which a launch alert's filters may name. */
  readonly isLaunchpad: (venue: string) => boolean;
  readonly ids: IdSource;
  readonly clock: Clock;
}

const defaultPageSize = 50;

// An alert set by an outside client, or in a turn that read outside content, is marked.
function isOutside(proposer: Proposer): boolean {
  return proposer.hasOutsideContent || proposer.role === "mcp_client";
}

const refusals = {
  not_found: "agent.not_found",
  too_many: "alert.too_many",
  track_limit: "wallet.track_limit",
} as const;

async function create(
  options: AlertHandlersOptions,
  call: EngineCall<"alert/create">,
): Promise<Result<AlertView, ProtocolErrorCode>> {
  const proposer = proposerOf(call.caller);
  if (proposer === undefined) {
    return err("auth.scope");
  }
  const { agent, wake } = call.args;
  const nowMs = options.clock.now();
  const context = { nowMs, chains: options.chains, isLaunchpad: options.isLaunchpad };
  const checked = checkAlertRequest(call.args, context);
  if (!checked.ok) {
    return checked;
  }
  const settings = await activeAgent(options.agents, agent, call);
  if (!settings.ok) {
    return settings;
  }
  const record: AlertRecord = {
    id: options.ids.next("alr"),
    agentId: agent,
    ...checked.value,
    state: "active",
    wake: wake ?? false,
    fires: 0,
    outsideContent: isOutside(proposer),
    createdBy: proposer.ref,
    createdAtMs: nowMs,
    changedAtMs: nowMs,
  };
  const stored = await options.alerts.create(record, call);
  return stored.ok ? ok(alertViewOf(stored.value)) : err(refusals[stored.error]);
}

function queryOf(args: EngineCall<"alert/list">["args"]): Result<AlertQuery, ProtocolErrorCode> {
  const after = args.cursor === undefined ? undefined : pageAfterOf("alr", args.cursor);
  if (args.cursor !== undefined && after === undefined) {
    return err("protocol.bad_args");
  }
  return ok({
    states: args.state === undefined ? [...alertStates] : [args.state],
    limit: args.limit ?? defaultPageSize,
    ...(args.agent === undefined ? {} : { agentId: args.agent }),
    ...(after === undefined ? {} : { after }),
  });
}

async function listed(options: AlertHandlersOptions, call: EngineCall<"alert/list">) {
  const query = queryOf(call.args);
  if (!query.ok) {
    return query;
  }
  const records = await options.alerts.list(query.value, call);
  const last = records.at(-1);
  const items = records.map(alertViewOf);
  return ok(
    records.length === query.value.limit && last !== undefined
      ? { items, next: nextCursorOf(last) }
      : { items },
  );
}

async function remove(
  options: AlertHandlersOptions,
  call: EngineCall<"alert/delete">,
): Promise<Result<ResultOf<"alert/delete">, ProtocolErrorCode>> {
  const proposer = proposerOf(call.caller);
  if (proposer === undefined) {
    return err("auth.scope");
  }
  const stored = await options.alerts.get(call.args.alert, call);
  if (stored?.state !== "active") {
    return err("alert.not_found");
  }
  // A client with `propose` alone deletes only the alerts it set, as with orders and schedules.
  if (proposer.role === "mcp_client" && stored.createdBy !== proposer.ref) {
    return err("auth.scope");
  }
  const deleted = await options.alerts.delete({ id: stored.id, atMs: options.clock.now() }, call);
  return deleted === undefined ? err("alert.not_found") : ok({});
}

/**
 * Creates the alert handlers (protocol spec, sections 7.5 and 8.4). `alert/create` stores an
 * active alert at once, with no card: an alert sends no transaction. It is marked when an outside
 * client or a marked turn set it, and refused with `alert.too_many` past 50 active alerts of the
 * agent and `wallet.track_limit` past 50 tracked wallets. `alert/list` pages through the alerts,
 * oldest first, of one agent or all, in one state or any. `alert/delete` ends an active alert.
 */
export function createAlertHandlers(options: AlertHandlersOptions): AlertHandlers {
  return {
    "alert/create": async (call) => create(options, call),
    "alert/list": async (call) => listed(options, call),
    "alert/delete": async (call) => remove(options, call),
  };
}
