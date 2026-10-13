import { err, type JsonValue, jsonValueSchema, ok } from "@binference/core";
import type { EngineCaller, EngineHandler } from "@binference/engine";
import type { RunningTurns } from "@binference/engine/chat";
import type { EngineHandlerTable } from "@binference/engine/surfaces";
import {
  type ArgsOf,
  type Operation,
  operations,
  type ProtocolId,
  protocolIdSchema,
  type ResultOf,
} from "@binference/protocol";
import type { RouteOrigin } from "@binference/runtime";
import { z } from "zod";
import type { RouteOutcome, RouteRequest } from "./route-calls.js";

/** The operations the agent runtime answers through the engine (protocol spec, section 7). */
export const routedOperations = [
  "chat/messages",
  "notes/search",
  "notes/list",
  "notes/write",
  "notes/delete",
] as const;

type RoutedName = (typeof routedOperations)[number];

/** Sends one routed call to the runtime. */
type Route = (request: RouteRequest, signal: AbortSignal) => Promise<RouteOutcome>;

/** The agent's open chat session, which the engine keeps (`agents.chat_session_id`). */
type OpenSession = (
  agent: ProtocolId<"agent">,
  signal: AbortSignal,
) => Promise<ProtocolId<"chatSession"> | undefined>;

/**
 * Who a routed call runs for (runtime spec, section 10; decision 0206): `owner` for a client with
 * `confirm` or `admin`; `agent` for the runtime the engine runs now, in a turn of the agent the
 * call names whose context holds no outside content; `untrusted` for every other caller, the
 * runtime in a marked turn or out of any turn, and any other client.
 */
export function originOf(
  caller: Pick<EngineCaller, "scopes" | "credential">,
  mark: { readonly turns: RunningTurns; readonly agent: ProtocolId<"agent"> | undefined },
): RouteOrigin {
  const { scopes, credential } = caller;
  if (scopes.includes("confirm") || scopes.includes("admin")) {
    return "owner";
  }
  const { turns, agent } = mark;
  const turn = agent === undefined ? undefined : turns.markOf(credential, agent);
  return turn?.hasOutsideContent === false ? "agent" : "untrusted";
}

const namesAgent = z.object({ agent: protocolIdSchema("agent") });

// The agent a routed call names, when it names one.
function agentOf(args: JsonValue): ProtocolId<"agent"> | undefined {
  const named = namesAgent.safeParse(args);
  return named.success ? named.data.agent : undefined;
}

function routed<N extends RoutedName>(
  name: N,
  parts: { readonly route: Route; readonly turns: RunningTurns },
): EngineHandler<N> {
  const operation: Operation<ArgsOf<N>, ResultOf<N>> = operations[name];
  return async ({ args, caller, signal }) => {
    // An explicit type argument keeps the generic args type; inference would widen it.
    const encoded = jsonValueSchema.parse(z.encode<z.ZodType<ArgsOf<N>>>(operation.args, args));
    const origin = originOf(caller, { turns: parts.turns, agent: agentOf(encoded) });
    const outcome = await parts.route({ op: name, args: encoded, origin }, signal);
    if (!outcome.ok) {
      return err(outcome.error);
    }
    const result = operation.result.safeParse(outcome.value);
    return result.success ? ok(result.data) : err("internal.error");
  };
}

// `chat/messages` names the agent's open session when the call names none; an agent with no session
// yet has no message.
function messagesOf(
  parts: { readonly route: Route; readonly turns: RunningTurns },
  openSession: OpenSession,
): EngineHandler<"chat/messages"> {
  const route = routed("chat/messages", parts);
  return async (call) => {
    if (call.args.session !== undefined) {
      return route(call);
    }
    const session = await openSession(call.args.agent, call.signal);
    return session === undefined
      ? ok({ items: [] })
      : route({ ...call, args: { ...call.args, session } });
  };
}

/**
 * The engine's handlers of the routed operations: each passes its call to the runtime with the
 * origin its caller and the runtime's running turns set, and answers the runtime's result as the
 * operation's schema reads it. A result that breaks the schema fails `internal.error`.
 * `chat/messages` with no session reads the agent's open one.
 */
export function createRoutedHandlers(
  route: Route,
  turns: RunningTurns,
  openSession: OpenSession,
): EngineHandlerTable {
  const parts = { route, turns };
  return {
    "chat/messages": messagesOf(parts, openSession),
    "notes/search": routed("notes/search", parts),
    "notes/list": routed("notes/list", parts),
    "notes/write": routed("notes/write", parts),
    "notes/delete": routed("notes/delete", parts),
  };
}
