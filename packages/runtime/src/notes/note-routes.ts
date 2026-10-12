import { type Clock, idSchema, type JsonValue, jsonValueSchema } from "@binference/core";
import {
  type ArgsOf,
  operations,
  type ProtocolError,
  type ProtocolErrorCode,
  type ResultOf,
} from "@binference/protocol";
import type { NoteRecord, NoteStore } from "@binference/store";
import { z } from "zod";
import type { RouteLine, RouteOrigin, RouteReplyLine } from "../control/control-line.schema.js";

/** What the routed notes operations read and write: the notes, under this start's fence. */
export interface NoteRouteParts {
  readonly notes: NoteStore;
  readonly fence: number;
  readonly clock: Clock;
}

type NoteOp = "notes/search" | "notes/list" | "notes/write" | "notes/delete";

// The longest note, as `agent.sqlite` keeps it.
const maxNoteChars = 12_000;
// A page of notes when the caller names no size (protocol spec, section 3).
const defaultLimit = 50;

/** A routed call's answer: the operation's result, or a protocol error. */
type RouteAnswer =
  | { readonly ok: true; readonly result: JsonValue }
  | { readonly ok: false; readonly error: ProtocolError };

function failed(code: ProtocolErrorCode, message: string): RouteAnswer {
  return { ok: false, error: { code, message, retryable: false } };
}

function answered<N extends NoteOp>(op: N, result: ResultOf<N>): RouteAnswer {
  const schema: z.ZodType<ResultOf<N>> = operations[op].result;
  return { ok: true, result: jsonValueSchema.parse(z.encode(schema, result)) };
}

function viewOf(note: NoteRecord): ResultOf<"notes/write"> {
  return {
    note: String(note.id),
    agent: note.agentId,
    text: note.text,
    origin: note.origin,
    createdAt: note.createdAtMs,
    changedAt: note.changedAtMs,
  };
}

// A page: `next` names the last note's number when the page is full.
function pageOf(notes: readonly NoteRecord[], limit: number): ResultOf<"notes/list"> {
  const last = notes.at(-1);
  const items = notes.map(viewOf);
  return notes.length === limit && last !== undefined
    ? { items, next: String(last.id) }
    : { items };
}

// The fence holds while this start runs; a later start raised it, and this one is on its way out.
function fenced(): RouteAnswer {
  return failed("runtime.unavailable", "A later runtime start holds agent.sqlite.");
}

function badArgs(): RouteAnswer {
  return failed("protocol.bad_args", "The routed call's args do not match its operation.");
}

async function search(args: ArgsOf<"notes/search">, parts: NoteRouteParts, signal: AbortSignal) {
  const limit = args.limit ?? defaultLimit;
  const agentId = idSchema("agt").parse(args.agent);
  const notes = await parts.notes.search(
    { agentId, query: args.query.slice(0, 200), limit },
    { signal },
  );
  return answered("notes/search", pageOf(notes, limit));
}

async function list(args: ArgsOf<"notes/list">, parts: NoteRouteParts, signal: AbortSignal) {
  const limit = args.limit ?? defaultLimit;
  const afterId = Number(args.cursor ?? "0");
  if (!Number.isSafeInteger(afterId) || afterId < 0) {
    return failed("protocol.bad_args", "The cursor is not one notes/list gave.");
  }
  const agentId = idSchema("agt").parse(args.agent);
  const notes = await parts.notes.list({ agentId, afterId, limit }, { signal });
  return answered("notes/list", pageOf(notes, limit));
}

async function write(
  args: ArgsOf<"notes/write">,
  context: {
    readonly parts: NoteRouteParts;
    readonly origin: RouteOrigin;
    readonly signal: AbortSignal;
  },
): Promise<RouteAnswer> {
  const { parts, origin, signal } = context;
  if (args.text.length > maxNoteChars) {
    return failed("protocol.bad_args", `A note holds at most ${String(maxNoteChars)} characters.`);
  }
  const draft = {
    agentId: idSchema("agt").parse(args.agent),
    text: args.text,
    origin,
    atMs: parts.clock.now(),
    fence: parts.fence,
  };
  const written = await parts.notes.write(draft, { signal });
  return written.ok ? answered("notes/write", viewOf(written.value)) : fenced();
}

async function remove(args: ArgsOf<"notes/delete">, parts: NoteRouteParts, signal: AbortSignal) {
  const note = Number(args.note);
  if (!Number.isSafeInteger(note) || note <= 0) {
    return failed("note.not_found", "No note has this id.");
  }
  const removal = { note, atMs: parts.clock.now(), fence: parts.fence };
  const removed = await parts.notes.delete(removal, { signal });
  if (removed.ok) {
    return answered("notes/delete", {});
  }
  return removed.error === "fenced" ? fenced() : failed("note.not_found", "No note has this id.");
}

async function answerOf(
  route: RouteLine & { readonly op: NoteOp },
  parts: NoteRouteParts,
  signal: AbortSignal,
): Promise<RouteAnswer> {
  const { op, args, origin } = route;
  if (op === "notes/search") {
    const parsed = operations[op].args.safeParse(args);
    return parsed.success ? search(parsed.data, parts, signal) : badArgs();
  }
  if (op === "notes/list") {
    const parsed = operations[op].args.safeParse(args);
    return parsed.success ? list(parsed.data, parts, signal) : badArgs();
  }
  if (op === "notes/write") {
    const parsed = operations[op].args.safeParse(args);
    return parsed.success ? write(parsed.data, { parts, origin, signal }) : badArgs();
  }
  const parsed = operations[op].args.safeParse(args);
  return parsed.success ? remove(parsed.data, parts, signal) : badArgs();
}

/** Whether the runtime answers a routed operation from the notes. */
export function isNoteRoute(route: RouteLine): route is RouteLine & { readonly op: NoteOp } {
  return route.op.startsWith("notes/");
}

/**
 * Answers a routed notes operation from `agent.sqlite` (runtime spec, section 10): a search, a
 * page of the list, a write with the origin the engine set from its caller, or a removal. Args
 * that break the operation's schema fail `protocol.bad_args`, a note that is not there
 * `note.not_found`, and a write after a later start raised the fence `runtime.unavailable`.
 */
export async function answerNoteRoute(
  route: RouteLine & { readonly op: NoteOp },
  parts: NoteRouteParts,
  signal: AbortSignal,
): Promise<RouteReplyLine> {
  const answer = await answerOf(route, parts, signal);
  return answer.ok
    ? { t: "routeReply", id: route.id, result: answer.result }
    : { t: "routeReply", id: route.id, error: answer.error };
}
