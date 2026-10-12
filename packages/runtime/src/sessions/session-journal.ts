import type { Clock, Id, JsonValue } from "@binference/core";
import type { EventDraft } from "@binference/store";
import type { OwnerMessage } from "../loop/model-message.js";
import type { TurnJournal } from "../loop/ports.js";
import { type AgentStores, written } from "./agent-stores.js";
import type { OwnerTextContent, ToolCallContent } from "./event-content.schema.js";

/** Where a journal writes: one turn of one session. */
export interface JournalPlace {
  readonly session: Id<"ses">;
  readonly turn: Id<"trn">;
}

/** The owner's messages as transcript events of a turn: each one outside content when it is. */
export function ownerEvents(
  messages: readonly OwnerMessage[],
  context: { readonly turn: Id<"trn">; readonly atMs: number },
): readonly EventDraft[] {
  return messages.map((message) => {
    const content: OwnerTextContent = { message: message.id, text: message.text };
    return {
      turnId: context.turn,
      role: "owner",
      kind: "text",
      content: { ...content },
      outside: message.outside,
      atMs: context.atMs,
    };
  });
}

function callContent(
  call: { readonly id: string; readonly name: string; readonly argumentsText: string },
  key?: string,
): JsonValue {
  const content: ToolCallContent = {
    callId: call.id,
    name: call.name,
    arguments: call.argumentsText,
    ...(key === undefined ? {} : { proposal: true, key }),
  };
  return { ...content };
}

type Writes<K extends keyof TurnJournal> = Pick<TurnJournal, K>;

interface JournalParts {
  readonly stores: AgentStores;
  readonly place: JournalPlace;
  readonly clock: Clock;
}

function eventOf(parts: JournalParts, draft: Omit<EventDraft, "turnId" | "atMs">): EventDraft {
  return { ...draft, turnId: parts.place.turn, atMs: parts.clock.now() };
}

async function append(
  parts: JournalParts,
  events: readonly EventDraft[],
  signal: AbortSignal,
): Promise<void> {
  const { transcript, fence } = parts.stores;
  const add = { sessionId: parts.place.session, events, fence };
  written(await transcript.append(add, { signal }), "append");
}

// The calls and results of a turn, and the messages that join it.
function eventWrites(
  parts: JournalParts,
): Writes<"response" | "toolCall" | "proposal" | "toolResult" | "joined"> {
  const { stores, place } = parts;
  const agentEvent = (kind: "text" | "tool_call", content: JsonValue): EventDraft =>
    eventOf(parts, { role: "agent", kind, content, outside: false });
  return {
    response: async ({ text, reasoning }, signal) =>
      append(parts, [agentEvent("text", { text, reasoning })], signal),
    toolCall: async (call, signal) =>
      append(parts, [agentEvent("tool_call", callContent(call))], signal),
    async proposal({ call, idempotencyKey }, signal) {
      const events = [agentEvent("tool_call", callContent(call, idempotencyKey))];
      const committing = {
        sessionId: place.session,
        turn: place.turn,
        events,
        fence: stores.fence,
      };
      written(await stores.transcript.appendCommitting(committing, { signal }), "commit");
    },
    async toolResult({ callId, name, text, isError, ran, outside }, signal) {
      const content = { callId, name, text, isError, ran };
      await append(
        parts,
        [eventOf(parts, { role: "tool", kind: "tool_result", content, outside })],
        signal,
      );
    },
    async joined(messages, signal) {
      if (messages.length > 0) {
        await append(
          parts,
          ownerEvents(messages, { turn: place.turn, atMs: parts.clock.now() }),
          signal,
        );
      }
    },
  };
}

/**
 * A turn's journal in `agent.sqlite` (runtime spec, section 11): each write is one store call
 * under the start's fence, done before it resolves; a proposal is stored with the turn's committed
 * mark in one write; a write the store refuses throws.
 */
export function createSessionJournal(
  stores: AgentStores,
  place: JournalPlace,
  clock: Clock,
): TurnJournal {
  const { turn } = place;
  const { fence } = stores;
  return {
    ...eventWrites({ stores, place, clock }),
    async markOutside(signal) {
      written(await stores.sessions.markOutside({ turn, fence }, { signal }), "mark");
    },
    async end({ outcome, heldBack }, signal) {
      const end = { turn, atMs: clock.now(), outcome, heldBack, fence };
      written(await stores.sessions.endTurn(end, { signal }), "end");
    },
  };
}
