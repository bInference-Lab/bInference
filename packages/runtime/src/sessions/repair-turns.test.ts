import { createManualClock } from "@binference/core/testing";
import { describe, expect, it } from "vitest";
import { createMemoryAgentStores, nthTestId } from "../testing/memory-agent-stores.js";
import type { AgentStores } from "./agent-stores.js";
import { loadConversation, notRunAfterRestart } from "./conversation.js";
import { proposalUnknownAfterRestart, repairUnfinishedTurns } from "./repair-turns.js";
import { createSessionJournal } from "./session-journal.js";

const live = (): AbortSignal => new AbortController().signal;
const agent = nthTestId("agt", 1);
const session = nthTestId("ses", 1);
const [first, second] = [nthTestId("trn", 1), nthTestId("trn", 2)];
const quote = { id: "c1", name: "quote", argumentsText: "{}" };
const swap = { id: "c2", name: "swap", argumentsText: '{"amount":"5"}' };

async function startTurn(stores: AgentStores, turn: typeof first, atMs: number): Promise<void> {
  const draft = { id: turn, sessionId: session, startedAtMs: atMs, outsideContent: false };
  await stores.sessions.startTurn({ ...draft, fence: stores.fence }, { signal: live() });
}

// A session with an ended turn, then a turn a crash cut off after its proposal was written.
async function crashedSession(stores: AgentStores): Promise<void> {
  const open = { id: session, agentId: agent, surface: "telegram", conversation: "telegram" };
  await stores.sessions.open({ ...open, startedAtMs: 1, fence: stores.fence }, { signal: live() });
  await startTurn(stores, first, 2);
  const done = createSessionJournal(stores, { session, turn: first }, createManualClock(3));
  await done.response({ text: "Hello", reasoning: "" }, live());
  await done.end({ outcome: "ok", heldBack: 0 }, live());
  await startTurn(stores, second, 4);
  const cut = createSessionJournal(stores, { session, turn: second }, createManualClock(5));
  await cut.response({ text: "Buying", reasoning: "" }, live());
  await cut.toolCall(quote, live());
  await cut.toolResult(
    { callId: "c1", name: "quote", text: "1", isError: false, outside: false, ran: true },
    live(),
  );
  await cut.proposal({ call: swap, idempotencyKey: `${second}.2` }, live());
  await cut.toolCall({ id: "c3", name: "quote", argumentsText: "{}" }, live());
}

describe("repairUnfinishedTurns", () => {
  it("answers every open call, never as sent again, and ends the turn failed", async () => {
    const memory = await createMemoryAgentStores();
    await crashedSession(memory.stores);
    const restarted = await memory.restart();
    const repaired = await repairUnfinishedTurns(restarted, {
      clock: createManualClock(9),
      signal: live(),
    });
    expect(repaired).toStrictEqual([{ agent, session, turn: second, proposalUnknown: true }]);
    await expect(restarted.sessions.turn(second, { signal: live() })).resolves.toMatchObject({
      outcome: "failed",
      committed: true,
    });
    await expect(restarted.sessions.turn(first, { signal: live() })).resolves.toMatchObject({
      outcome: "ok",
    });
    const loaded = await loadConversation(restarted.transcript, session, live());
    expect(loaded.messages.filter((message) => message.role === "tool")).toStrictEqual([
      { role: "tool", callId: "c1", name: "quote", text: "1", isError: false },
      {
        role: "tool",
        callId: "c2",
        name: "swap",
        text: proposalUnknownAfterRestart,
        isError: true,
      },
      { role: "tool", callId: "c3", name: "quote", text: notRunAfterRestart, isError: true },
    ]);
    await expect(restarted.sessions.unfinishedTurns({ signal: live() })).resolves.toStrictEqual([]);
  });

  it("ends a turn with no open call failed and finds no proposal in doubt", async () => {
    const memory = await createMemoryAgentStores();
    const { stores } = memory;
    const open = { id: session, agentId: agent, surface: "cli", conversation: "cli" };
    await stores.sessions.open(
      { ...open, startedAtMs: 1, fence: stores.fence },
      { signal: live() },
    );
    await startTurn(stores, first, 2);
    const restarted = await memory.restart();
    const repaired = await repairUnfinishedTurns(restarted, {
      clock: createManualClock(9),
      signal: live(),
    });
    expect(repaired).toStrictEqual([{ agent, session, turn: first, proposalUnknown: false }]);
    await expect(
      restarted.transcript.events({ sessionId: session, limit: 10 }, { signal: live() }),
    ).resolves.toStrictEqual([]);
  });
});
