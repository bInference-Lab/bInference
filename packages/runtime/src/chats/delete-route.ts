import { type Id, idSchema, jsonValueSchema } from "@binference/core";
import type { ProtocolErrorCode } from "@binference/protocol";
import type { ChatDeletion } from "@binference/store";
import { z } from "zod";
import type { RouteLine, RouteReplyLine } from "../control/control-line.schema.js";
import type { ChatRunner } from "./chat-runner.js";

/**
 * The args the engine routes a chat deletion with (decision 0415): the agents it resolved, one or
 * every agent not archived.
 */
interface ChatDeleteRoute {
  readonly agents: readonly Id<"agt">[];
}

/**
 * What the runtime answers a routed chat deletion with: the rows of `agent.sqlite` that went, by
 * what they were.
 */
export interface ChatDeleteRouteResult {
  readonly sessions: number;
  readonly turns: number;
  readonly events: number;
  readonly messages: number;
  readonly goals: number;
  readonly progressNotes: number;
  readonly helpers: number;
}

/** Parses the args of a routed chat deletion: 1 to 1,000 agents. */
const chatDeleteRouteSchema: z.ZodType<ChatDeleteRoute> = z.strictObject({
  agents: z.array(idSchema("agt")).min(1).max(1_000),
});

const count = z.int().nonnegative();

/** Parses the runtime's answer to a routed chat deletion. */
export const chatDeleteRouteResultSchema: z.ZodType<ChatDeleteRouteResult> = z.strictObject({
  sessions: count,
  turns: count,
  events: count,
  messages: count,
  goals: count,
  progressNotes: count,
  helpers: count,
});

/** What the routed chat deletion works with: the chat, the deletion, under this start's fence. */
export interface DeleteRouteParts {
  readonly runner: Pick<ChatRunner, "deleteChats">;
  readonly deletion: ChatDeletion;
  readonly fence: number;
}

function refused(route: RouteLine, code: ProtocolErrorCode, message: string): RouteReplyLine {
  return { t: "routeReply", id: route.id, error: { code, message, retryable: false } };
}

/** Whether the runtime answers a routed operation by deleting chats. */
export function isDeleteRoute(route: RouteLine): boolean {
  return route.op === "chat/delete";
}

/**
 * Answers a routed chat deletion (decision 0415): each agent's running turn ends and its helpers
 * stop, then one store task deletes their chats, and the answer counts what went. Args that name
 * no agent fail `protocol.bad_args`, and a deletion after a later start raised the fence
 * `runtime.unavailable`.
 */
export async function answerDeleteRoute(
  route: RouteLine,
  parts: DeleteRouteParts,
  signal: AbortSignal,
): Promise<RouteReplyLine> {
  const parsed = chatDeleteRouteSchema.safeParse(route.args);
  if (!parsed.success) {
    return refused(route, "protocol.bad_args", "A chat deletion names the agents it deletes.");
  }
  const { agents } = parsed.data;
  const deleted = await parts.runner.deleteChats(agents, async () =>
    parts.deletion.delete({ agents, fence: parts.fence }, { signal }),
  );
  if (!deleted.ok) {
    return refused(route, "runtime.unavailable", "A later runtime start holds agent.sqlite.");
  }
  const result = jsonValueSchema.parse(chatDeleteRouteResultSchema.parse(deleted.value));
  return { t: "routeReply", id: route.id, result };
}
