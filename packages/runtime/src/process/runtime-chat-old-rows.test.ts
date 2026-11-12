import { BinferenceError, type Id } from "@binference/core";
import { createManualClock, createMemoryLogger } from "@binference/core/testing";
import type { InboxMessageView } from "@binference/protocol";
import {
  openTestAgentSqlite,
  setQueuedPayloadTextTask,
  type TestAgentSqlite,
} from "@binference/store/testing";
import { afterEach, describe, expect, it } from "vitest";
import { payloadOf } from "../chats/queued-view.js";
import { testToolBox } from "../loop/test-turns.js";
import { turnLimits } from "../loop/turn-run.js";
import { nthTestId } from "../testing/memory-agent-stores.js";
import { createMemoryContextSource } from "../testing/memory-context-source.js";
import { createMemoryEngineChat, type MemoryEngineChat } from "../testing/memory-engine-chat.js";
import { createMemoryImageReader } from "../testing/memory-image-reader.js";
import {
  createScriptedTransport,
  oneModelChain,
  textReply,
} from "../testing/scripted-transport.js";
import { fixtureStartLine } from "../testing/start-line-fixture.js";
import type { AgentDatabase } from "./agent-database.js";
import { prepareChat, type RuntimeChat, startChat } from "./runtime-chat.js";
import { agentDatabaseOn } from "./sqlite-agent-database.js";

const agent = nthTestId("agt", 1);
const nul = "\u0000";
const fffd = String.fromCodePoint(0xfffd);
// Each call gets its own 30 s: one signal made at import would bound the whole file.
const call = (): { readonly signal: AbortSignal } => ({ signal: AbortSignal.timeout(30_000) });

const files: TestAgentSqlite[] = [];
const running: RuntimeChat[] = [];
afterEach(async () => {
  await Promise.all(running.splice(0).map(async (chat) => chat.runner.stop()));
  await Promise.all(files.splice(0).map(async (file) => file.close()));
});

// A migrated `agent.sqlite` on the store's workers, served with the task that plants old rows.
async function agentSqlite(): Promise<{ file: TestAgentSqlite; database: AgentDatabase }> {
  const file = await openTestAgentSqlite(call());
  files.push(file);
  return { file, database: agentDatabaseOn(file.handle, file.schemaVersion) };
}

// The runtime's chat started on the database and the engine, its one model answering `Hello.`,
// once it rests.
async function started(database: AgentDatabase, engine: MemoryEngineChat) {
  const clock = createManualClock(10_000);
  const logger = createMemoryLogger({ subsystem: "runtime" });
  const transport = createScriptedTransport([textReply("Hello.")]);
  const lifetime = new AbortController().signal;
  const prepared = await prepareChat(database, { clock, signal: lifetime });
  const chat = await startChat({
    prepared,
    engine,
    turnContext: createMemoryContextSource({ now: () => clock.now() }),
    images: createMemoryImageReader(new Map()),
    settings: () => fixtureStartLine().settings,
    setup: () => ({
      models: oneModelChain(transport, clock),
      tools: testToolBox([]),
      instructions: "You are a test agent.",
      limits: turnLimits,
    }),
    clock,
    logger,
    lifetime,
  });
  running.push(chat);
  await chat.runner.rested();
  return { transport, logger, prepared };
}

/** An owner's message as the engine lists it. */
type PostedView = Extract<InboxMessageView, { readonly kind: "inbox/message" }>;

// The one message the engine lists, an owner's.
async function listedOf(engine: MemoryEngineChat): Promise<PostedView> {
  const [view] = (await engine.listInbox(undefined, call().signal)).items;
  if (view?.kind !== "inbox/message") {
    throw new BinferenceError({ code: "test.no_view", message: "The engine listed no post." });
  }
  return view;
}

// Queues the engine's message as a runtime before decision 0416 left it: its session open, its
// payload written whole with `text` in place of its words.
async function queuedOld(
  at: { readonly file: TestAgentSqlite; readonly database: AgentDatabase },
  view: PostedView,
  text: string,
): Promise<void> {
  const { file, database } = at;
  const fence = await database.fence.raise(call());
  const session = { id: view.session, agentId: agent, surface: "cli", conversation: "cli" };
  await database.sessions.open({ ...session, startedAtMs: 1, fence }, call());
  const kind = "inbox/message" as const;
  const queued = { message: view.message, agentId: agent, sessionId: view.session, kind };
  await database.queue.add({ ...queued, payload: payloadOf(view), receivedAtMs: 1, fence }, call());
  const payload = JSON.stringify(payloadOf({ ...view, text }));
  await file.handle.run(setQueuedPayloadTextTask, { message: view.message, text: payload }, call());
}

// The chat queue, refusing to add one message as the store refuses U+0000.
function refusing(queue: AgentDatabase["queue"], message: Id<"msg">): AgentDatabase["queue"] {
  const refusal = new BinferenceError({ code: "store.nul_text", message: "Refused." });
  return {
    ...queue,
    add: async (draft, options) =>
      draft.message === message ? Promise.reject(refusal) : queue.add(draft, options),
  };
}

describe("the runtime's chat with messages stored before decision 0416", () => {
  it("starts with an untaken message the engine stored holding U+0000, and answers it with U+FFFD", async () => {
    const { database } = await agentSqlite();
    const engine = createMemoryEngineChat([agent]);
    const posted = engine.post(agent, `gm${nul}ser`);
    const { transport, prepared } = await started(database, engine);
    expect(transport.requests[0]?.messages).toStrictEqual([
      { role: "owner", text: `gm${fffd}ser` },
    ]);
    expect(engine.untaken()).toStrictEqual([]);
    const events = await prepared.stores.transcript.events(
      { sessionId: posted.session, limit: 10 },
      call(),
    );
    expect(events.map(({ content }) => content)).toMatchObject([
      { text: `gm${fffd}ser` },
      { text: "Hello." },
    ]);
  });

  it("runs the turn of a message the chat queue held with U+0000, with U+FFFD", async () => {
    const at = await agentSqlite();
    const engine = createMemoryEngineChat([agent]);
    const posted = engine.post(agent, "gm ser");
    const view = await listedOf(engine);
    await engine.takeInbox([posted.message], call().signal);
    await queuedOld(at, view, `gm${nul}ser`);
    const { transport } = await started(at.database, engine);
    expect(transport.requests[0]?.messages).toStrictEqual([
      { role: "owner", text: `gm${fffd}ser` },
    ]);
  });

  it("starts though the chat queue refuses one message, which stays in the engine, and takes the next", async () => {
    const { database } = await agentSqlite();
    const engine = createMemoryEngineChat([agent]);
    const refused = engine.post(agent, "first");
    engine.post(agent, "second");
    const queue = refusing(database.queue, refused.message);
    const { transport, logger } = await started({ ...database, queue }, engine);
    expect(engine.untaken()).toStrictEqual([refused.message]);
    expect(transport.requests[0]?.messages).toStrictEqual([{ role: "owner", text: "second" }]);
    expect(logger.records()).toContainEqual(
      expect.objectContaining({
        event: "runtime.message_left",
        fields: { agentId: agent, errorCode: "store.nul_text" },
      }),
    );
  });
});
