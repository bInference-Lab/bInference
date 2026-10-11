import { err, jsonValueSchema, ok } from "@binference/core";
import type { EngineCaller, EngineHandler } from "@binference/engine";
import type { EngineHandlerTable } from "@binference/engine/surfaces";
import { type ArgsOf, type Operation, operations, type ResultOf } from "@binference/protocol";
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

/**
 * Who a routed call runs for (runtime spec, section 10): `owner` for a client with `confirm` or
 * `admin`, `agent` for the runtime and for any other reader, which may only read.
 */
export function originOf(caller: Pick<EngineCaller, "scopes">): RouteOrigin {
  const { scopes } = caller;
  return scopes.includes("confirm") || scopes.includes("admin") ? "owner" : "agent";
}

function routed<N extends RoutedName>(name: N, route: Route): EngineHandler<N> {
  const operation: Operation<ArgsOf<N>, ResultOf<N>> = operations[name];
  return async ({ args, caller, signal }) => {
    // An explicit type argument keeps the generic args type; inference would widen it.
    const encoded = jsonValueSchema.parse(z.encode<z.ZodType<ArgsOf<N>>>(operation.args, args));
    const outcome = await route({ op: name, args: encoded, origin: originOf(caller) }, signal);
    if (!outcome.ok) {
      return err(outcome.error);
    }
    const result = operation.result.safeParse(outcome.value);
    return result.success ? ok(result.data) : err("internal.error");
  };
}

/**
 * The engine's handlers of the routed operations: each passes its call to the runtime with the
 * origin the caller's scopes set, and answers the runtime's result as the operation's schema reads
 * it. A result that breaks the schema fails `internal.error`.
 */
export function createRoutedHandlers(route: Route): EngineHandlerTable {
  return {
    "chat/messages": routed("chat/messages", route),
    "notes/search": routed("notes/search", route),
    "notes/list": routed("notes/list", route),
    "notes/write": routed("notes/write", route),
    "notes/delete": routed("notes/delete", route),
  };
}
