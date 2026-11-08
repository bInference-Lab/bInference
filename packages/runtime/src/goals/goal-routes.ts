import { type Clock, type Id, idSchema, jsonValueSchema } from "@binference/core";
import {
  type ArgsOf,
  type GoalRead,
  type GoalView,
  operations,
  type ProtocolErrorCode,
} from "@binference/protocol";
import type { SessionStore } from "@binference/store";
import { z } from "zod";
import type { RouteLine, RouteReplyLine } from "../control/control-line.schema.js";
import { written } from "../sessions/agent-stores.js";
import type { GoalDesk, GoalReading, GoalRefusal } from "./goal-desk.js";
import { goalViewOf, noteViewOf } from "./goal-views.js";

/** What the routed goal operations work with. */
export interface GoalRouteParts {
  readonly desk: GoalDesk;
  readonly sessions: Pick<SessionStore, "get" | "open">;
  readonly fence: number;
  readonly clock: Clock;
  /** Follows a goal the owner changed: the chat asks for its next goal turn, or stops asking. */
  readonly follow: (chat: { readonly agent: Id<"agt">; readonly session: Id<"ses"> }) => void;
}

type GoalOp = "goal/get" | "goal/set" | "goal/change";

const refusalCodes: Readonly<Record<GoalRefusal, ProtocolErrorCode>> = {
  exists: "goal.exists",
  none: "goal.none",
  no_session: "goal.no_chat",
  done: "goal.done",
};

function reply(
  route: RouteLine,
  op: GoalOp,
  result: GoalRead | { readonly goal: GoalView },
): RouteReplyLine {
  const schema: z.ZodType = operations[op].result;
  return { t: "routeReply", id: route.id, result: jsonValueSchema.parse(z.encode(schema, result)) };
}

function failed(route: RouteLine, code: ProtocolErrorCode, message: string): RouteReplyLine {
  return { t: "routeReply", id: route.id, error: { code, message, retryable: false } };
}

function readOf(reading: GoalReading): GoalRead {
  const { goal, note } = reading;
  return {
    ...(goal === undefined ? {} : { goal: goalViewOf(goal) }),
    ...(note === undefined ? {} : { note: noteViewOf(note) }),
  };
}

// The chat a call names, its session row opened when the runtime has not seen it yet, as an
// owner's goal may come before the chat's first turn; another agent's session names none.
async function chatOf(
  parts: GoalRouteParts,
  args: { readonly agent: string; readonly session?: string },
  signal: AbortSignal,
): Promise<{ readonly agent: Id<"agt">; readonly session: Id<"ses"> } | undefined> {
  const agent = idSchema("agt").parse(args.agent);
  if (args.session === undefined) {
    return undefined;
  }
  const session = idSchema("ses").parse(args.session);
  const stored = await parts.sessions.get(session, { signal });
  if (stored === undefined) {
    const draft = { id: session, agentId: agent, surface: "engine", conversation: "engine" };
    const opened = { ...draft, startedAtMs: parts.clock.now(), fence: parts.fence };
    const open = await parts.sessions.open(opened, { signal });
    if (!open.ok && open.error !== "exists") {
      written(open, "open a session");
    }
  }
  return stored === undefined || stored.agentId === agent ? { agent, session } : undefined;
}

async function change(
  route: RouteLine,
  parts: GoalRouteParts,
  call: { readonly args: ArgsOf<"goal/change">; readonly signal: AbortSignal },
): Promise<RouteReplyLine> {
  const { args, signal } = call;
  const chat = await chatOf(parts, args, signal);
  if (chat === undefined) {
    return failed(route, "goal.no_chat", "The agent has no such chat.");
  }
  if (args.action === "clear") {
    const had = await parts.desk.clear(chat, signal);
    parts.follow(chat);
    return had ? reply(route, "goal/change", {}) : failed(route, "goal.none", "No goal to clear.");
  }
  const move =
    args.action === "pause"
      ? ({ to: "pause", reason: "owner" } as const)
      : ({ to: "resume" } as const);
  const moved = await parts.desk.move(chat, move, signal);
  parts.follow(chat);
  return moved.ok
    ? reply(route, "goal/change", readOf(await parts.desk.read(chat.session, signal)))
    : failed(route, refusalCodes[moved.error], "The goal cannot change so.");
}

async function set(
  route: RouteLine,
  parts: GoalRouteParts,
  call: { readonly args: ArgsOf<"goal/set">; readonly signal: AbortSignal },
): Promise<RouteReplyLine> {
  const { args, signal } = call;
  const chat = await chatOf(parts, args, signal);
  if (chat === undefined) {
    return failed(route, "goal.no_chat", "The agent has no such chat.");
  }
  const budget = args.budgetUsdMicros === undefined ? {} : { budgetMicros: args.budgetUsdMicros };
  const request = { ...chat, objective: args.objective, ...budget };
  const goal = await parts.desk.set(request, signal);
  if (!goal.ok) {
    return failed(route, refusalCodes[goal.error], "The goal was not set.");
  }
  parts.follow(chat);
  return reply(route, "goal/set", { goal: goalViewOf(goal.value) });
}

/** Whether the runtime answers a routed operation from the chats' goals. */
export function isGoalRoute(route: RouteLine): route is RouteLine & { readonly op: GoalOp } {
  return route.op === "goal/get" || route.op === "goal/set" || route.op === "goal/change";
}

const badArgs = "The routed call's args do not match its operation.";

async function read(route: RouteLine, parts: GoalRouteParts, signal: AbortSignal) {
  const args = operations["goal/get"].args.safeParse(route.args);
  if (!args.success) {
    return failed(route, "protocol.bad_args", badArgs);
  }
  const { session } = args.data;
  const reading =
    session === undefined ? {} : await parts.desk.read(idSchema("ses").parse(session), signal);
  return reply(route, "goal/get", readOf(reading));
}

/**
 * Answers the routed goal operations (decision 0407): `goal/get` reads a chat's goal and progress
 * note; `goal/set` and `goal/change` change it for the owner alone, any other origin `auth.scope`,
 * and the chat then asks for its next goal turn while the goal is active, or stops asking.
 */
export async function answerGoalRoute(
  route: RouteLine & { readonly op: GoalOp },
  parts: GoalRouteParts,
  signal: AbortSignal,
): Promise<RouteReplyLine> {
  if (route.op === "goal/get") {
    return read(route, parts, signal);
  }
  if (route.origin !== "owner") {
    return failed(route, "auth.scope", "Only the owner changes a chat's goal.");
  }
  if (route.op === "goal/set") {
    const args = operations["goal/set"].args.safeParse(route.args);
    return args.success
      ? set(route, parts, { args: args.data, signal })
      : failed(route, "protocol.bad_args", badArgs);
  }
  const args = operations["goal/change"].args.safeParse(route.args);
  return args.success
    ? change(route, parts, { args: args.data, signal })
    : failed(route, "protocol.bad_args", badArgs);
}
