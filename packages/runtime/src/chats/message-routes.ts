import { idSchema, jsonValueSchema } from "@binference/core";
import { type ArgsOf, operations, type ResultOf } from "@binference/protocol";
import type {
  SessionRecord,
  SessionStore,
  TranscriptEvent,
  TranscriptStore,
} from "@binference/store";
import { z } from "zod";
import type { RouteLine, RouteReplyLine } from "../control/control-line.schema.js";
import { toolCallContentSchema } from "../sessions/event-content.schema.js";

/** What `chat/messages` reads: the sessions and their transcripts in `agent.sqlite`. */
export interface MessageRouteParts {
  readonly sessions: Pick<SessionStore, "get">;
  readonly transcript: Pick<TranscriptStore, "events">;
}

type MessagesOp = "chat/messages";
type MessageView = ResultOf<MessagesOp>["items"][number];

// A page of messages when the caller names no size (protocol spec, section 3).
const defaultLimit = 50;
// The text an owner's or the agent's message, a tool's result and a summary each keep.
const textContent = z.object({ text: z.string() });

// The text a person reads of an event: a call as its tool's name and arguments; an image none.
function textOf(event: TranscriptEvent): string | undefined {
  if (event.kind === "image") {
    return undefined;
  }
  if (event.kind === "tool_call") {
    const call = toolCallContentSchema.safeParse(event.content);
    return call.success ? `${call.data.name} ${call.data.arguments}` : undefined;
  }
  const content = textContent.safeParse(event.content);
  return content.success ? content.data.text : undefined;
}

function viewOf(event: TranscriptEvent): MessageView {
  const text = textOf(event);
  const view = {
    session: event.sessionId,
    seq: event.seq,
    role: event.role,
    kind: event.kind,
    at: event.atMs,
    ...(text === undefined ? {} : { text }),
  };
  return event.turnId === undefined ? view : { ...view, turn: event.turnId };
}

function replyOf(route: RouteLine, page: ResultOf<MessagesOp>): RouteReplyLine {
  const schema: z.ZodType<ResultOf<MessagesOp>> = operations["chat/messages"].result;
  return { t: "routeReply", id: route.id, result: jsonValueSchema.parse(z.encode(schema, page)) };
}

function refused(route: RouteLine, message: string): RouteReplyLine {
  const error = { code: "protocol.bad_args", message, retryable: false } as const;
  return { t: "routeReply", id: route.id, error };
}

// The agent's session the call names, or none when it names none or one of another agent.
async function sessionOf(
  args: ArgsOf<MessagesOp>,
  parts: MessageRouteParts,
  signal: AbortSignal,
): Promise<SessionRecord | undefined> {
  if (args.session === undefined) {
    return undefined;
  }
  const session = await parts.sessions.get(idSchema("ses").parse(args.session), { signal });
  return session?.agentId === args.agent ? session : undefined;
}

async function pageOf(
  args: ArgsOf<MessagesOp>,
  parts: MessageRouteParts,
  signal: AbortSignal,
): Promise<ResultOf<MessagesOp> | undefined> {
  const afterSeq = Number(args.cursor ?? "0");
  if (!Number.isSafeInteger(afterSeq) || afterSeq < 0) {
    return undefined;
  }
  const session = await sessionOf(args, parts, signal);
  if (session === undefined) {
    return { items: [] };
  }
  const limit = args.limit ?? defaultLimit;
  const query = { sessionId: session.id, afterSeq, limit };
  const items = (await parts.transcript.events(query, { signal })).map(viewOf);
  const last = items.at(-1);
  return items.length === limit && last !== undefined
    ? { items, next: String(last.seq) }
    : { items };
}

/** Whether the runtime answers a routed operation from the transcript. */
export function isMessagesRoute(
  route: RouteLine,
): route is RouteLine & { readonly op: MessagesOp } {
  return route.op === "chat/messages";
}

/**
 * Answers `chat/messages` from `agent.sqlite` (runtime spec, section 10): a page of one of the
 * agent's sessions, oldest first after the cursor, each event as a message with its role, kind,
 * time and turn, and its text (a tool call as its name and arguments, an image with none). The
 * cursor is the last message's `seq`; `next` names it when the page is full. A session the agent
 * does not hold reads as no message; args that break the operation's schema, or a cursor no page
 * gave, fail `protocol.bad_args`.
 */
export async function answerMessagesRoute(
  route: RouteLine & { readonly op: MessagesOp },
  parts: MessageRouteParts,
  signal: AbortSignal,
): Promise<RouteReplyLine> {
  const args = operations[route.op].args.safeParse(route.args);
  if (!args.success) {
    return refused(route, "The routed call's args do not match its operation.");
  }
  const page = await pageOf(args.data, parts, signal);
  return page === undefined
    ? refused(route, "The cursor is not one chat/messages gave.")
    : replyOf(route, page);
}
