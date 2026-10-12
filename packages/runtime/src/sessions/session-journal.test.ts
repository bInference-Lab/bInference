import type { Id } from "@binference/core";
import { createManualClock } from "@binference/core/testing";
import type { TranscriptEvent } from "@binference/store";
import { describe, expect, it } from "vitest";
import type { JournalEntry, JournalView } from "../contracts/turn-journal-contract.js";
import { turnJournalContract } from "../contracts/turn-journal-contract.js";
import { createMemoryAgentStores, nthTestId } from "../testing/memory-agent-stores.js";
import type { AgentStores } from "./agent-stores.js";
import { conversationOf } from "./conversation.js";
import {
  agentTextContentSchema,
  ownerTextContentSchema,
  toolCallContentSchema,
  toolResultContentSchema,
} from "./event-content.schema.js";
import { createSessionJournal } from "./session-journal.js";

const live = (): { readonly signal: AbortSignal } => ({ signal: new AbortController().signal });
const session = nthTestId("ses", 1);
const turn = nthTestId("trn", 1);

async function openTurn(stores: AgentStores): Promise<void> {
  const { fence } = stores;
  const draft = { id: session, agentId: nthTestId("agt", 1), surface: "telegram" };
  await stores.sessions.open({ ...draft, conversation: "telegram", startedAtMs: 1, fence }, live());
  const start = { id: turn, sessionId: session, startedAtMs: 2, outsideContent: false, fence };
  await stores.sessions.startTurn(start, live());
}

function entryOf(event: TranscriptEvent): readonly JournalEntry[] {
  if (event.kind === "tool_call") {
    const { callId: id, key } = toolCallContentSchema.parse(event.content);
    return [key === undefined ? { kind: "call", id } : { kind: "proposal", id, key }];
  }
  if (event.kind === "tool_result") {
    const { callId: id, ran } = toolResultContentSchema.parse(event.content);
    return [{ kind: "result", id, ran, outside: event.outside }];
  }
  return event.role === "agent"
    ? [{ kind: "response", text: agentTextContentSchema.parse(event.content).text }]
    : [];
}

// The contract joins one batch of owner messages; the store keeps one event for each.
function joinedOf(events: readonly TranscriptEvent[]): readonly JournalEntry[] {
  const ids = events
    .filter((event) => event.role === "owner")
    .map((event) => ownerTextContentSchema.parse(event.content).message);
  return ids.length === 0 ? [] : [{ kind: "joined", ids }];
}

function readBack(stores: AgentStores, id: Id<"ses">): () => Promise<JournalView> {
  return async () => {
    const events = await stores.transcript.events({ sessionId: id, limit: 100 }, live());
    const record = await stores.sessions.turn(turn, live());
    const end = record?.outcome === undefined ? undefined : record;
    return {
      entries: [...events.flatMap(entryOf), ...joinedOf(events)],
      committed: record?.committed === true,
      outside: record?.outsideContent === true,
      ...(end === undefined
        ? {}
        : { end: { outcome: end.outcome ?? "ok", heldBack: end.heldBack } }),
    };
  };
}

describe("createSessionJournal", () => {
  it.each(
    turnJournalContract({
      create: async () => {
        const { stores } = await createMemoryAgentStores();
        await openTurn(stores);
        const journal = createSessionJournal(stores, { session, turn }, createManualClock(5));
        return { journal, read: readBack(stores, session) };
      },
    }),
  )("keeps the journal contract: $name", async ({ run }) => {
    await expect(run()).resolves.toBeUndefined();
  });

  it("keeps a response's replay as its provider gave it, and loads it back", async () => {
    const { stores } = await createMemoryAgentStores();
    await openTurn(stores);
    const journal = createSessionJournal(stores, { session, turn }, createManualClock(5));
    const replay = {
      format: "messages",
      content: [{ type: "thinking", thinking: "", signature: "c2ln" }],
    } as const;
    await journal.response({ text: "", reasoning: "", replay }, live().signal);
    const events = await stores.transcript.events({ sessionId: session, limit: 10 }, live());
    expect(conversationOf(events)).toStrictEqual([
      { role: "agent", text: "", reasoning: "", toolCalls: [], replay },
    ]);
  });

  it("throws when a later start raised the fence, and writes nothing", async () => {
    const memory = await createMemoryAgentStores();
    await openTurn(memory.stores);
    const journal = createSessionJournal(memory.stores, { session, turn }, createManualClock(5));
    await memory.restart();
    await expect(
      journal.response({ text: "late", reasoning: "" }, live().signal),
    ).rejects.toMatchObject({
      code: "runtime.store_refused",
      details: { refusal: "fenced" },
    });
    await expect(
      memory.stores.transcript.events({ sessionId: session, limit: 10 }, live()),
    ).resolves.toStrictEqual([]);
  });
});
