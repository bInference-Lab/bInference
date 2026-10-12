import { createManualClock } from "@binference/core/testing";
import { describe, expect, it } from "vitest";
import { type EngineView, turnEngineContract } from "../contracts/turn-engine-contract.js";
import type { AgentStores } from "../sessions/agent-stores.js";
import { createMemoryAgentStores, nthTestId } from "../testing/memory-agent-stores.js";
import { createMemoryEngineChat, type MemoryEngineChat } from "../testing/memory-engine-chat.js";
import { createRelayTurnEngine } from "./relay-turn-engine.js";

const agent = nthTestId("agt", 1);
const live = (): AbortSignal => new AbortController().signal;
const outcomes = ["ok", "stopped", "failed", "budget", "loop"] as const;

// The owner posts; the runtime holds the message in its chat queue, in a session it opened.
async function posted(engine: MemoryEngineChat, stores: AgentStores) {
  const message = engine.post(agent, "hello");
  const { fence } = stores;
  const session = { id: message.session, agentId: agent, surface: "cli", conversation: "cli" };
  await stores.sessions.open({ ...session, startedAtMs: 1, fence }, { signal: live() });
  const draft = { message: message.message, agentId: agent, sessionId: message.session };
  const queued = { ...draft, kind: "inbox/message" as const, payload: {}, receivedAtMs: 2, fence };
  await stores.queue.add(queued, { signal: live() });
  return message;
}

function viewOf(engine: MemoryEngineChat): EngineView {
  const running = engine.running(agent);
  const ended = engine.pushes.findLast((push) => push.kind === "chat/turnEnded");
  const outcome = outcomes.find((each) => each === ended?.detail);
  const details = (kind: string) =>
    engine.pushes.filter((push) => push.kind === kind).map((push) => push.detail ?? "");
  return {
    ...(running === undefined ? {} : { started: { messages: running.messages, outside: false } }),
    running: running !== undefined,
    marked: running?.marked === true,
    said: details("chat/message"),
    statusKeys: details("chat/status"),
    ...(outcome === undefined ? {} : { ended: outcome }),
  };
}

async function subject(refuse: "archived" | "not_found" | undefined) {
  const engine = createMemoryEngineChat(refuse === "not_found" ? [] : [agent]);
  if (refuse === "archived") {
    engine.refuse(agent, { started: false, refusal: "archived" });
  }
  const { stores } = await createMemoryAgentStores();
  const message = await posted(engine, stores);
  const place = { agent, session: message.session, turn: message.turn };
  const taken = [{ id: message.message, text: "hello", outside: false }];
  const relay = createRelayTurnEngine({
    chat: engine,
    stores,
    place,
    taken,
    clock: createManualClock(5),
  });
  return { engine, stores, message, relay };
}

describe("createRelayTurnEngine", () => {
  it.each(
    turnEngineContract({
      create: async ({ refuse }) => {
        const { engine, message, relay } = await subject(refuse);
        return { engine: relay, messages: [message.message], read: async () => viewOf(engine) };
      },
    }),
  )("keeps the engine contract: $name", async ({ run }) => {
    await expect(run()).resolves.toBeUndefined();
  });

  it("writes the turn's row, takes its messages and keeps them once the engine started it", async () => {
    const { stores, message, relay } = await subject(undefined);
    await relay.start({ messages: [message.message], outsideContent: true }, live());
    await expect(stores.sessions.turn(message.turn, { signal: live() })).resolves.toMatchObject({
      sessionId: message.session,
      outsideContent: true,
    });
    const queued = await stores.queue.waiting(
      { sessionId: message.session, limit: 10 },
      { signal: live() },
    );
    expect(queued).toStrictEqual([]);
    const events = await stores.transcript.events(
      { sessionId: message.session, limit: 10 },
      { signal: live() },
    );
    expect(events).toMatchObject([
      { role: "owner", kind: "text", content: { message: message.message, text: "hello" } },
    ]);
  });

  it("shows when chat resumes as the engine refuses a turn for a spent budget", async () => {
    const { engine, stores, message } = await subject(undefined);
    engine.refuse(agent, { started: false, refusal: "budget", resumesAt: 9 });
    const place = { agent, session: message.session, turn: message.turn };
    const clock = createManualClock(5);
    const relay = createRelayTurnEngine({ chat: engine, stores, place, taken: [], clock });
    await relay.start({ messages: [message.message], outsideContent: false }, live());

    expect(engine.pushes.filter(({ kind }) => kind === "chat/status")).toStrictEqual([
      {
        kind: "chat/status",
        agent,
        turn: message.turn,
        detail: "turn.budget",
        values: { when: 9 },
      },
    ]);
  });

  it("shows no paused line for a refusal that is not the budget", async () => {
    const { engine, stores, message } = await subject(undefined);
    engine.refuse(agent, { started: false, refusal: "frozen" });
    const place = { agent, session: message.session, turn: message.turn };
    const clock = createManualClock(5);
    const relay = createRelayTurnEngine({ chat: engine, stores, place, taken: [], clock });
    await relay.start({ messages: [message.message], outsideContent: false }, live());

    expect(engine.pushes.filter(({ kind }) => kind === "chat/status")).toStrictEqual([]);
  });

  it("writes nothing when the engine refuses the turn, and says why", async () => {
    const { engine, stores, message } = await subject(undefined);
    engine.refuse(agent, { started: false, refusal: "budget", resumesAt: 9 });
    const heard: unknown[] = [];
    const place = { agent, session: message.session, turn: message.turn };
    const relay = createRelayTurnEngine({
      chat: engine,
      stores,
      place,
      taken: [],
      clock: createManualClock(5),
      onRefused: (refusal) => heard.push(refusal),
    });
    await expect(
      relay.start({ messages: [message.message], outsideContent: false }, live()),
    ).resolves.toStrictEqual({
      ok: false,
      error: "budget",
    });
    expect(heard).toStrictEqual([{ started: false, refusal: "budget", resumesAt: 9 }]);
    await expect(stores.sessions.turn(message.turn, { signal: live() })).resolves.toBeUndefined();
  });
});
