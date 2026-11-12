import { err, ok } from "@binference/core";
import type { RuntimeChats } from "@binference/engine/chat";
import { chatDeleteRouteResultSchema } from "@binference/runtime";
import type { RouteOutcome, RouteRequest } from "./route-calls.js";

/** What the runtime's side of a chat deletion reaches the runtime through. */
interface RuntimeChatsParts {
  /** Sends one routed call to the runtime. */
  readonly route: (request: RouteRequest, signal: AbortSignal) => Promise<RouteOutcome>;
  /** Whether the runtime is up: started, and `ready` since. */
  readonly isUp: () => boolean;
}

/**
 * The runtime's side of `chat/delete` (decision 0415): a route of `chat/delete` with the agents the
 * engine resolved, for the owner, answered by the rows the runtime deleted. A reply in another
 * shape fails `internal.error`.
 */
export function createRuntimeChats(parts: RuntimeChatsParts): RuntimeChats {
  return {
    isUp: () => parts.isUp(),
    async delete(agents, { signal }) {
      const request = {
        op: "chat/delete",
        args: { agents: [...agents] },
        origin: "owner",
      } as const;
      const outcome = await parts.route(request, signal);
      if (!outcome.ok) {
        return outcome;
      }
      const deleted = chatDeleteRouteResultSchema.safeParse(outcome.value);
      return deleted.success ? ok(deleted.data) : err("internal.error");
    },
  };
}
