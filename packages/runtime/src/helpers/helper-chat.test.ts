import { createIdSource, type Id, jsonValueSchema } from "@binference/core";
import { createManualClock, createSeededRandom } from "@binference/core/testing";
import { operations } from "@binference/protocol";
import { createMemoryHelperStore } from "@binference/store/testing";
import { describe, expect, it } from "vitest";
import { createChatRunner } from "../chats/chat-runner.js";
import type { ModelEvent } from "../loop/model-event.js";
import { testToolBox } from "../loop/test-turns.js";
import { turnLimits } from "../loop/turn-run.js";
import { createFakeToolClient } from "../testing/fake-tool-client.js";
import { createMemoryAgentStores, nthTestId } from "../testing/memory-agent-stores.js";
import { createMemoryContextSource } from "../testing/memory-context-source.js";
import { createMemoryEngineChat } from "../testing/memory-engine-chat.js";
import {
  callsReply,
  createScriptedTransport,
  oneModelChain,
  type ScriptedReply,
  textReply,
} from "../testing/scripted-transport.js";
import { createToolBox } from "../tools/create-tool-box.js";
import { helperTools } from "../tools/helper-tools.js";
import { createBudgetMemory } from "./budget-memory.js";
import { createHelperDesk } from "./helper-desk.js";

const agent = nthTestId("agt", 1);
const live = (): AbortSignal => new AbortController().signal;

// A helper that searches once and reports.
const helperReplies: readonly ScriptedReply[] = [
  callsReply([{ name: "search_web", args: { query: "BNB" } }]),
  textReply("BNB is quiet today."),
];

// A model call that never answers until the run is halted.
const hangs: ScriptedReply = (signal) =>
  (async function* (): AsyncGenerator<ModelEvent> {
    await new Promise((resolve) => {
      signal.addEventListener("abort", resolve, { once: true });
    });
    yield { type: "error", failure: "aborted", message: "Stopped." };
  })();

// The owner's chat and the agent's helpers on one fake engine: the agent's turns call the real
// helper tools, and a helper's turns call one read tool, `outside` or not.
async function startChat(given: {
  readonly outside: boolean;
  readonly helperReplies?: readonly ScriptedReply[];
}) {
  const engine = createMemoryEngineChat([agent]);
  const { stores, database } = await createMemoryAgentStores();
  const clock = createManualClock(10_000);
  const client = createFakeToolClient({ "helper/ended": {} });
  const turnContext = createMemoryContextSource({ now: () => clock.now() });
  const budgets = createBudgetMemory();
  const brief = { task: "Find today's BNB news and report it.", label: "BNB news" };
  const own = createScriptedTransport([
    callsReply([{ name: "helper_start", args: brief }]),
    textReply("A helper looks into it."),
    textReply("Here is what my helper found: BNB is quiet."),
  ]);
  const helper = createScriptedTransport(given.helperReplies ?? helperReplies);
  const desk = createHelperDesk({
    stores,
    helpers: createMemoryHelperStore(database),
    engine,
    context: turnContext,
    client,
    setup: () => ({
      models: oneModelChain(helper, clock),
      tools: testToolBox([{ name: "search_web", kind: "read", outside: given.outside }]),
      instructions: "You are a test helper.",
      limits: turnLimits,
    }),
    budgets,
    clock,
    ids: createIdSource({ clock, random: createSeededRandom(4) }),
    lifetime: new AbortController().signal,
    providers: () => ["test"],
  });
  const runner = createChatRunner({
    stores,
    engine,
    turnContext,
    setup: (place) => ({
      models: oneModelChain(own, clock),
      tools: createToolBox(helperTools({ agent, client, turn: place }, { desk, clock })),
      instructions: "You are a test agent.",
      limits: turnLimits,
    }),
    mode: () => "merge",
    clock,
    lifetime: new AbortController().signal,
    budgets,
    onStop: (stopped) => desk.stopAgent(stopped),
  });
  const taking = { last: Promise.resolve() };
  engine.watchInbox({
    onMessage: (view) => {
      taking.last = runner.receive(view);
    },
    refetch: async () => Promise.resolve(),
  });
  return { engine, stores, client, desk, runner, own, helper, taking };
}

type Chat = Awaited<ReturnType<typeof startChat>>;

// The engine relays the helper's end it took as `helper/ended`: a message that wakes the agent.
async function relayEnd(chat: Chat, session: Id<"ses">): Promise<Id<"trn">> {
  const taken = chat.client.calls().find(({ op }) => op === "helper/ended");
  const ended = operations["helper/ended"].args.parse(jsonValueSchema.parse(taken?.args));
  const turn = nthTestId("trn", 90);
  const view = {
    kind: "inbox/message" as const,
    message: nthTestId("msg", 90),
    agent,
    session,
    at: 20_000,
    turn,
    text: ended.text,
    surface: ended.surface,
    ...(ended.outsideContent ? { outsideContent: true } : {}),
  };
  await chat.runner.receive(view);
  return turn;
}

async function settle(chat: Chat): Promise<void> {
  await chat.taking.last;
  await chat.runner.rested();
  await chat.desk.rested();
  await chat.runner.rested();
}

describe("a helper in the owner's chat", () => {
  it("works beside the agent's turn, and its report starts the agent's answer", async () => {
    const chat = await startChat({ outside: false });
    const posted = chat.engine.post(agent, "Look up BNB news in the background.");
    await settle(chat);
    expect(chat.helper.requests).toHaveLength(2);
    const said = chat.engine.pushes.filter(({ kind }) => kind === "chat/message");
    expect(said.map(({ detail }) => detail)).toStrictEqual(["A helper looks into it."]);
    const wake = await relayEnd(chat, posted.session);
    await settle(chat);
    const answer = chat.engine.pushes.findLast(({ kind }) => kind === "chat/message");
    expect(answer?.detail).toBe("Here is what my helper found: BNB is quiet.");
    const told = JSON.stringify(chat.own.requests[2]?.messages.at(-1));
    expect(told).toContain("BNB is quiet today.");
    const turn = await chat.stores.sessions.turn(wake, { signal: live() });
    expect(turn?.outsideContent).toBe(false);
  });

  it("starts the agent's answer marked when its helper read outside content", async () => {
    const chat = await startChat({ outside: true });
    const posted = chat.engine.post(agent, "Look up BNB news in the background.");
    await settle(chat);
    const wake = await relayEnd(chat, posted.session);
    await settle(chat);
    const turn = await chat.stores.sessions.turn(wake, { signal: live() });
    expect(turn?.outsideContent).toBe(true);
  });

  it("stops the agent's helpers with the owner's stop, and no answer follows", async () => {
    const chat = await startChat({ outside: false, helperReplies: [hangs] });
    chat.engine.post(agent, "Look up BNB news in the background.");
    await chat.taking.last;
    await chat.runner.rested();
    const [running] = await chat.desk.list(agent, live());
    expect(running?.state).toBe("running");
    chat.engine.stop(agent);
    await settle(chat);
    const [stopped] = await chat.desk.list(agent, live());
    expect(stopped?.state).toBe("stopped");
    expect(chat.client.calls().filter(({ op }) => op === "helper/ended")).toStrictEqual([]);
    expect(chat.own.requests).toHaveLength(2);
  });
});
