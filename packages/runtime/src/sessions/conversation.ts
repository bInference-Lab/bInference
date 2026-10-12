import { type Id, type JsonValue, jsonValueSchema } from "@binference/core";
import type { TranscriptEvent, TranscriptStore } from "@binference/store";
import type { ResponseReplay } from "../loop/model-event.js";
import type { ModelMessage, ToolCall } from "../loop/model-message.js";
import {
  agentTextContentSchema,
  ownerTextContentSchema,
  toolCallContentSchema,
  toolResultContentSchema,
} from "./event-content.schema.js";

/** The result a call with no stored result gets when the conversation loads. */
export const notRunAfterRestart = "not run: the agent restarted";

type ToolEntry = Extract<ModelMessage, { readonly role: "tool" }>;
type OwnerEntry = Extract<ModelMessage, { readonly role: "owner" }>;

/** One model response as it loads: its calls, their results, and owner messages held after them. */
interface OpenResponse {
  readonly text: string;
  readonly reasoning: string;
  readonly replay?: ResponseReplay;
  readonly calls: ToolCall[];
  readonly results: Map<string, ToolEntry>;
  readonly held: OwnerEntry[];
}

// Arguments go back to a provider only as a JSON object; anything else goes back as `{}`.
function sentArguments(text: string): string {
  try {
    const parsed = jsonValueSchema.safeParse(JSON.parse(text));
    const value = parsed.success ? parsed.data : null;
    return typeof value === "object" && value !== null && !Array.isArray(value) ? text : "{}";
  } catch {
    return "{}";
  }
}

// The response with each call followed by its one result, then the messages held behind them.
function closed(response: OpenResponse): readonly ModelMessage[] {
  const results = response.calls.map(
    (call): ToolEntry =>
      response.results.get(call.id) ?? {
        role: "tool",
        callId: call.id,
        name: call.name,
        text: notRunAfterRestart,
        isError: true,
      },
  );
  const agent = {
    role: "agent" as const,
    text: response.text,
    reasoning: response.reasoning,
    toolCalls: [...response.calls],
    ...(response.replay === undefined ? {} : { replay: response.replay }),
  };
  return [agent, ...results, ...response.held];
}

function opened(said: {
  readonly text: string;
  readonly reasoning: string;
  readonly replay?: ResponseReplay;
}): OpenResponse {
  return { ...said, calls: [], results: new Map(), held: [] };
}

/** Builds a conversation from transcript events, one at a time, repairing it as it goes. */
interface Builder {
  add(event: TranscriptEvent): void;
  /** Closes the last response and answers the conversation. */
  finish(): readonly ModelMessage[];
}

function createBuilder(): Builder {
  const messages: ModelMessage[] = [];
  const state: { open: OpenResponse | undefined } = { open: undefined };
  const close = (): void => {
    if (state.open !== undefined) {
      messages.push(...closed(state.open));
      state.open = undefined;
    }
  };
  const handlers = {
    call: (content: JsonValue) => {
      state.open ??= opened({ text: "", reasoning: "" });
      addCall(state.open, content);
    },
    result: (content: JsonValue) => {
      if (state.open !== undefined) {
        addResult(state.open, content);
      }
    },
    response: (content: JsonValue) => {
      const parsed = agentTextContentSchema.safeParse(content);
      if (parsed.success) {
        close();
        state.open = opened(parsed.data);
      }
    },
    owner: (content: JsonValue) => {
      const entry = ownerEntryOf(content);
      if (entry !== undefined && !holds(state.open, entry)) {
        close();
        messages.push(entry);
      }
    },
  };
  return {
    add: (event) => handlerOf(event, handlers)?.(event.content),
    finish: () => {
      close();
      return messages;
    },
  };
}

function addCall(response: OpenResponse, content: JsonValue): void {
  const parsed = toolCallContentSchema.safeParse(content);
  if (!parsed.success || response.calls.some((call) => call.id === parsed.data.callId)) {
    return;
  }
  const { callId: id, name } = parsed.data;
  response.calls.push({ id, name, argumentsText: sentArguments(parsed.data.arguments) });
}

function addResult(response: OpenResponse, content: JsonValue): void {
  const parsed = toolResultContentSchema.safeParse(content);
  if (!parsed.success) {
    return;
  }
  const { callId, name, text, isError } = parsed.data;
  const isOpen = response.calls.some((call) => call.id === callId) && !response.results.has(callId);
  if (isOpen) {
    response.results.set(callId, { role: "tool", callId, name, text, isError });
  }
}

function ownerEntryOf(content: JsonValue): OwnerEntry | undefined {
  const parsed = ownerTextContentSchema.safeParse(content);
  return parsed.success ? { role: "owner", text: parsed.data.text } : undefined;
}

// An owner message stored while a call of the open response waits for its result is held, to
// follow the results.
function holds(response: OpenResponse | undefined, entry: OwnerEntry): boolean {
  if (response === undefined || response.results.size >= response.calls.length) {
    return false;
  }
  response.held.push(entry);
  return true;
}

type Handlers = Readonly<
  Record<"call" | "result" | "response" | "owner", (content: JsonValue) => void>
>;

function handlerOf(event: TranscriptEvent, handlers: Handlers) {
  if (event.kind === "tool_call") {
    return handlers.call;
  }
  if (event.kind === "tool_result") {
    return handlers.result;
  }
  if (event.kind !== "text") {
    return undefined;
  }
  if (event.role === "agent") {
    return handlers.response;
  }
  return event.role === "owner" ? handlers.owner : undefined;
}

/**
 * The conversation a session's transcript events give the model, repaired as it loads (decision
 * 0174): each call's one result follows the response that made it, a second result or one with no
 * call is left out, a call with no result gets {@link notRunAfterRestart}, an owner message stored
 * between a call and its result follows the results, and arguments that are not a JSON object go
 * back as `{}`. Events of a kind the model does not read yet are left out.
 */
export function conversationOf(events: readonly TranscriptEvent[]): readonly ModelMessage[] {
  const builder = createBuilder();
  for (const event of events) {
    builder.add(event);
  }
  return builder.finish();
}

/** A session's conversation, and whether any event of it holds outside content. */
export interface LoadedConversation {
  readonly messages: readonly ModelMessage[];
  readonly outside: boolean;
}

const pageSize = 1_000;

async function eventsOf(
  transcript: TranscriptStore,
  sessionId: Id<"ses">,
  signal: AbortSignal,
): Promise<readonly TranscriptEvent[]> {
  const events: TranscriptEvent[] = [];
  for (;;) {
    const afterSeq = events.at(-1)?.seq ?? 0;
    // oxlint-disable-next-line eslint/no-await-in-loop -- each page starts after the one before
    const page = await transcript.events({ sessionId, afterSeq, limit: pageSize }, { signal });
    events.push(...page);
    if (page.length < pageSize) {
      return events;
    }
  }
}

/** Loads a session's transcript as the conversation the next turn sends the model. */
export async function loadConversation(
  transcript: TranscriptStore,
  sessionId: Id<"ses">,
  signal: AbortSignal,
): Promise<LoadedConversation> {
  const events = await eventsOf(transcript, sessionId, signal);
  return {
    messages: conversationOf(events),
    outside: events.some((event) => event.outside),
  };
}
