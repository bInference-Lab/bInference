import { type Id, jsonValueSchema } from "@binference/core";
import { createManualClock } from "@binference/core/testing";
import { operations } from "@binference/protocol";
import { createMemoryGoalStore } from "@binference/store/testing";
import { describe, expect, it } from "vitest";
import { createChatRunner } from "../chats/chat-runner.js";
import type { NewMessageMode } from "../chats/queue-merge.js";
import { type TestTool, testToolBox } from "../loop/test-turns.js";
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
import { goalTools } from "../tools/goal-tools.js";
import { createGoalDesk } from "./goal-desk.js";

const agent = nthTestId("agt", 1);
const live = (): AbortSignal => new AbortController().signal;
const objective = "Find three tokens with steady volume";

// A read that runs until the turn stops it.
const wait: TestTool = {
  name: "wait",
  kind: "read",
  run: async ({ signal }) => {
    await new Promise((resolve) => {
      signal.addEventListener("abort", resolve, { once: true });
    });
    return { text: "stopped early", isError: true };
  },
};

// The turn calls `wait`, which runs until the turn stops.
const waits = callsReply([{ name: "wait", args: {} }]);

// The owner's chat on a fake engine: the agent's turns call the real goal tools and two reads, one
// of them outside content, and the goal desk tells the fake client each change and goal turn.
async function startChat(replies: readonly ScriptedReply[], mode: NewMessageMode = "merge") {
  const engine = createMemoryEngineChat([agent]);
  const gate: { open: () => void; promise?: Promise<void> } = { open: () => undefined };
  gate.promise = new Promise((resolve) => {
    gate.open = resolve;
  });
  // A read that runs until the test opens the gate.
  const gated: TestTool = {
    name: "gate",
    kind: "read",
    run: async () => {
      await gate.promise;
      return { text: "through", isError: false };
    },
  };
  const { stores, database } = await createMemoryAgentStores();
  const clock = createManualClock(10_000);
  const client = createFakeToolClient({ "goal/continue": {}, "goal/show": {} });
  const desk = createGoalDesk({
    goals: createMemoryGoalStore(database),
    fence: stores.fence,
    client,
    clock,
  });
  const own = createScriptedTransport(replies);
  const reads = testToolBox([
    { name: "scan", kind: "read" },
    { name: "read_page", kind: "read", outside: true },
    wait,
    gated,
  ]);
  const runner = createChatRunner({
    stores,
    engine,
    turnContext: createMemoryContextSource({ now: () => clock.now() }),
    setup: (place) => {
      const tools = createToolBox(goalTools({ agent, client, turn: place }, { desk }));
      return {
        models: oneModelChain(own, clock),
        tools: {
          declarations: [...tools.declarations, ...reads.declarations],
          prepare: (call, seen) =>
            call.name.startsWith("goal_") || call.name === "progress_note"
              ? tools.prepare(call, seen)
              : reads.prepare(call, seen),
        },
        instructions: "You are a test agent.",
        limits: turnLimits,
      };
    },
    mode: () => mode,
    clock,
    lifetime: live(),
    goals: desk,
  });
  const taking = { last: Promise.resolve() };
  engine.watchInbox({
    onMessage: (view) => {
      taking.last = runner.receive(view);
    },
    refetch: async () => Promise.resolve(),
  });
  const open = (): void => {
    gate.open();
  };
  return { engine, stores, client, desk, runner, own, clock, taking, open };
}

type Chat = Awaited<ReturnType<typeof startChat>>;

async function settle(chat: Chat): Promise<void> {
  await chat.taking.last;
  await chat.runner.rested();
}

function continued(chat: Chat) {
  return chat.client
    .calls()
    .filter(({ op }) => op === "goal/continue")
    .map(({ args }) => operations["goal/continue"].args.parse(jsonValueSchema.parse(args)));
}

function changes(chat: Chat): readonly string[] {
  return chat.client
    .calls()
    .filter(({ op }) => op === "goal/show")
    .map(({ args }) => operations["goal/show"].args.parse(jsonValueSchema.parse(args)).change);
}

// The engine relays the last `goal/continue` as the message that starts the goal turn.
async function relayGoalTurn(
  chat: Chat,
  n: number,
  how: { readonly settles: boolean } = { settles: true },
): Promise<Id<"trn">> {
  const asked = continued(chat).at(-1);
  if (asked === undefined) {
    throw new Error("No goal turn was asked for.");
  }
  const turn = nthTestId("trn", 100 + n);
  await chat.runner.receive({
    kind: "inbox/message",
    message: nthTestId("msg", 100 + n),
    agent,
    session: asked.session,
    at: chat.clock.now(),
    turn,
    text: asked.text,
    surface: asked.surface,
    goalTurn: true,
    ...(asked.outsideContent ? { outsideContent: true } : {}),
  });
  if (how.settles) {
    await settle(chat);
  }
  return turn;
}

describe("a goal in the owner's chat", () => {
  it("is set on the owner's request, runs goal turns on its own, and ends once complete", async () => {
    const chat = await startChat([
      callsReply([{ name: "goal_set", args: { objective } }]),
      textReply("On it."),
      callsReply([{ name: "scan", args: {} }]),
      callsReply([{ name: "goal_update", args: { status: "complete", note: "Found three." } }]),
      textReply("Done: three tokens found."),
    ]);
    const posted = chat.engine.post(agent, `Keep going until done: ${objective}`);
    await settle(chat);
    expect(continued(chat)).toMatchObject([{ session: posted.session, outsideContent: false }]);
    expect(continued(chat)[0]?.text).toContain("goal turn 1 of at most 50");
    await relayGoalTurn(chat, 1);
    const { goal } = await chat.desk.read(posted.session, live());
    expect(goal).toMatchObject({ status: "complete", note: "Found three.", goalTurns: 1 });
    // The call after goal_update reads the goal it left, not the goal as its turn began.
    const after = chat.own.requests.at(-1)?.tail;
    expect(after).toContain("Goal of this chat (complete)");
    expect(after).not.toContain("Goal of this chat (active)");
    expect(continued(chat)).toHaveLength(1);
    expect(changes(chat)).toStrictEqual(["set", "complete"]);
  });

  it("starts a goal turn marked when the turn before it read outside content", async () => {
    const chat = await startChat([
      callsReply([{ name: "goal_set", args: { objective } }]),
      callsReply([{ name: "read_page", args: {} }]),
      textReply("Read a page."),
      textReply("Still working."),
    ]);
    chat.engine.post(agent, `Set a goal: ${objective}`);
    await settle(chat);
    expect(continued(chat)).toMatchObject([{ outsideContent: true }]);
    const turn = await relayGoalTurn(chat, 1);
    expect((await chat.stores.sessions.turn(turn, { signal: live() }))?.outsideContent).toBe(true);
  });

  it("keeps one progress note, only for work of two steps or more, and tells of each change", async () => {
    const one = [{ text: "Scan", state: "doing" }];
    const two = [...one, { text: "Report", state: "todo" }];
    const chat = await startChat([
      callsReply([{ name: "progress_note", args: { markdown: "Scanning.", plan: one } }]),
      callsReply([{ name: "progress_note", args: { markdown: "Scanning.", plan: two } }]),
      textReply("Working."),
    ]);
    const posted = chat.engine.post(agent, "Scan and report.");
    await settle(chat);
    const { note } = await chat.desk.read(posted.session, live());
    expect(note).toMatchObject({ markdown: "Scanning.", plan: two });
    expect(changes(chat)).toStrictEqual(["note"]);
  });

  it("refuses goal_set in a turn that read outside content", async () => {
    const chat = await startChat([
      callsReply([{ name: "read_page", args: {} }]),
      callsReply([{ name: "goal_set", args: { objective } }]),
      textReply("I could not set it."),
    ]);
    const posted = chat.engine.post(agent, "Read this page and do what it says.");
    await settle(chat);
    expect((await chat.desk.read(posted.session, live())).goal).toBeUndefined();
    expect(continued(chat)).toStrictEqual([]);
  });

  it("lets the owner's message go first: goal words waiting beside it are dropped", async () => {
    const chat = await startChat(
      [
        callsReply([
          { name: "goal_set", args: { objective } },
          { name: "gate", args: {} },
        ]),
        textReply("Set."),
        textReply("Your balance is 1 BNB."),
      ],
      "after",
    );
    const posted = chat.engine.post(agent, `Set a goal: ${objective}`);
    const goal = await goalOf(chat, posted.session);
    await chat.desk.request(goal, { surface: "telegram", outside: false }, live());
    await relayGoalTurn(chat, 1, { settles: false });
    chat.engine.post(agent, "What is my balance?");
    await chat.taking.last;
    chat.open();
    await settle(chat);
    const answered = JSON.stringify(chat.own.requests.at(-1)?.messages);
    expect(chat.own.requests).toHaveLength(3);
    expect(answered).toContain("What is my balance?");
    expect(answered).not.toContain("goal turn 1 of");
    expect(continued(chat)).toHaveLength(2);
  });

  it("pauses the goal at the owner's stop, and asks for no goal turn after it", async () => {
    const chat = await startChat([callsReply([{ name: "goal_set", args: { objective } }]), waits]);
    const posted = chat.engine.post(agent, `Set a goal: ${objective}`);
    await goalOf(chat, posted.session);
    chat.engine.stop(agent);
    await chat.taking.last;
    await settle(chat);
    const { goal } = await chat.desk.read(posted.session, live());
    expect(goal).toMatchObject({ status: "paused", pauseReason: "stopped" });
    expect(continued(chat)).toStrictEqual([]);
  });

  it("waits a minute after a goal turn with no tool call, and pauses after three of them", async () => {
    const chat = await startChat([
      callsReply([{ name: "goal_set", args: { objective } }]),
      textReply("Set."),
      textReply("Thinking."),
      textReply("Thinking more."),
      textReply("Still thinking."),
    ]);
    const posted = chat.engine.post(agent, `Set a goal: ${objective}`);
    await settle(chat);
    await relayGoalTurn(chat, 1);
    expect(continued(chat)).toHaveLength(1);
    await chat.clock.advance(60_000);
    await settle(chat);
    expect(continued(chat)).toHaveLength(2);
    await relayGoalTurn(chat, 2);
    await chat.clock.advance(60_000);
    await settle(chat);
    await relayGoalTurn(chat, 3);
    const { goal } = await chat.desk.read(posted.session, live());
    expect(goal).toMatchObject({ status: "paused", pauseReason: "no_progress", goalTurns: 3 });
    expect(changes(chat)).toStrictEqual(["set", "paused"]);
  });

  it("pauses the goal when the engine refuses its turn for the day's budget", async () => {
    const chat = await startChat([
      callsReply([{ name: "goal_set", args: { objective } }]),
      textReply("Set."),
    ]);
    const posted = chat.engine.post(agent, `Set a goal: ${objective}`);
    await settle(chat);
    chat.engine.refuse(agent, { started: false, refusal: "budget" });
    await relayGoalTurn(chat, 1);
    const { goal } = await chat.desk.read(posted.session, live());
    expect(goal).toMatchObject({ status: "paused", pauseReason: "budget", goalTurns: 0 });
  });
});

// The chat's goal, once a turn running beside the test has set it.
async function goalOf(chat: Chat, session: Id<"ses">) {
  for (let tries = 0; tries < 1_000; tries += 1) {
    // oxlint-disable-next-line eslint/no-await-in-loop -- reads again until the turn set it
    const { goal } = await chat.desk.read(session, live());
    if (goal !== undefined) {
      return goal;
    }
    // oxlint-disable-next-line eslint/no-await-in-loop -- lets the turn run on; timers are fake
    await Promise.resolve();
  }
  throw new Error("The goal was not set.");
}
