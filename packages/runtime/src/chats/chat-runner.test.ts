import type { Id } from "@binference/core";
import type { InboxMessageView } from "@binference/protocol";
import type { QueuedMessage } from "@binference/store";
import { describe, expect, it } from "vitest";
import { createGate, type TestTool } from "../loop/test-turns.js";
import { startChatRig, type ChatRig } from "../testing/chat-rig.js";
import { createMemoryAgentStores, nthTestId } from "../testing/memory-agent-stores.js";
import { callsReply, type ScriptedReply, textReply } from "../testing/scripted-transport.js";
import { payloadOf } from "./queued-view.js";

const live = (): { readonly signal: AbortSignal } => ({ signal: new AbortController().signal });

/** What the owner's post answered. */
type Posted = Awaited<ReturnType<ChatRig["post"]>>;

// A control tool whose run is the owner writing again while the call runs.
function poster(
  rig: () => ChatRig,
  kind: TestTool["kind"] = "control",
  posts: Posted[] = [],
): TestTool {
  return {
    name: kind === "propose" ? "swap" : "poster",
    kind,
    run: async () => {
      posts.push(await rig().post("and BNB"));
      return {
        text: kind === "propose" ? "waits for the owner's confirmation" : "noted",
        isError: false,
      };
    },
  };
}

// A read that runs until the turn stops it, after saying it started.
function waiter(started: () => void): TestTool {
  return {
    name: "wait",
    kind: "read",
    run: async ({ signal }) => {
      started();
      await new Promise((resolve) => signal.addEventListener("abort", resolve, { once: true }));
      return { text: "stopped early", isError: true };
    },
  };
}

function turnsStarted(rig: ChatRig): readonly Id<"trn">[] {
  return rig.engine.pushes
    .filter((push) => push.kind === "chat/turnStarted")
    .map((push) => push.turn);
}

function details(rig: ChatRig, kind: string): readonly string[] {
  return rig.engine.pushes.filter((push) => push.kind === kind).map((push) => push.detail ?? "");
}

function dropReasons(rig: ChatRig): Readonly<Record<string, string>> {
  return Object.fromEntries(
    [...rig.database.queue.values()].flatMap((message) =>
      message.dropReason === undefined ? [] : [[message.message, message.dropReason]],
    ),
  );
}

async function queued(
  rig: ChatRig,
  session: Id<"ses">,
  message: Id<"msg">,
): Promise<QueuedMessage | undefined> {
  const all = await rig.stores.queue.waiting({ sessionId: session, limit: 200 }, live());
  return all.find((each) => each.message === message);
}

describe("createChatRunner", () => {
  it("runs a turn from the owner's message to its end", async () => {
    const rig = await startChatRig({ replies: [textReply("Hello.")] });
    const posted = await rig.post("hi");
    await rig.runner.rested();
    expect(turnsStarted(rig)).toStrictEqual([posted.turn]);
    expect(details(rig, "chat/message")).toStrictEqual(["Hello."]);
    expect(details(rig, "chat/turnEnded")).toStrictEqual(["ok"]);
    expect(rig.engine.untaken()).toStrictEqual([]);
    const events = await rig.stores.transcript.events(
      { sessionId: posted.session, limit: 10 },
      live(),
    );
    expect(events.map(({ role, kind }) => `${role} ${kind}`)).toStrictEqual([
      "owner text",
      "agent text",
    ]);
  });

  it("merges a message at the next tool boundary in merge mode", async () => {
    const rig = await startChatRig({
      replies: [
        callsReply([
          { id: "c1", name: "poster" },
          { id: "c2", name: "quote" },
        ]),
        textReply("Done."),
      ],
      tools: (rigNow) => [poster(rigNow), { name: "quote", kind: "read" }],
    });
    const posted = await rig.post("price?");
    await rig.runner.rested();
    expect(turnsStarted(rig)).toStrictEqual([posted.turn]);
    expect(rig.transport.requests[1]?.messages.slice(-3)).toStrictEqual([
      { role: "tool", callId: "c1", name: "poster", text: "noted", isError: false },
      {
        role: "tool",
        callId: "c2",
        name: "quote",
        text: "not run: a new message came in",
        isError: true,
      },
      { role: "owner", text: "and BNB" },
    ]);
  });

  it("starts the next turn with a message in after mode", async () => {
    const posts: Posted[] = [];
    const rig = await startChatRig({
      mode: "after",
      replies: [
        callsReply([
          { id: "c1", name: "poster" },
          { id: "c2", name: "quote" },
        ]),
        textReply("One."),
        textReply("Two."),
      ],
      tools: (rigNow) => [poster(rigNow, "control", posts), { name: "quote", kind: "read" }],
    });
    const first = await rig.post("price?");
    await rig.runner.rested();
    expect(turnsStarted(rig)).toStrictEqual([first.turn, posts[0]?.turn]);
    expect(rig.transport.requests[1]?.messages.at(-1)).toMatchObject({
      role: "tool",
      text: "ran quote",
    });
    expect(rig.transport.requests[2]?.messages.at(-1)).toStrictEqual({
      role: "owner",
      text: "and BNB",
    });
    expect(details(rig, "chat/message")).toStrictEqual(["One.", "Two."]);
  });

  it("starts a new turn with a message that came after a committed batch", async () => {
    const rig = await startChatRig({
      replies: [callsReply([{ id: "c1", name: "swap" }]), textReply("Reported.")],
      tools: (rigNow) => [poster(rigNow, "propose")],
    });
    await rig.post("buy it");
    await rig.runner.rested();
    expect(turnsStarted(rig)).toHaveLength(2);
    expect(rig.transport.requests).toHaveLength(2);
    expect(details(rig, "chat/status")).toStrictEqual(["turn.proposalWaits"]);
    expect(rig.transport.requests[1]?.messages.slice(-2)).toStrictEqual([
      {
        role: "tool",
        callId: "c1",
        name: "swap",
        text: "waits for the owner's confirmation",
        isError: false,
      },
      { role: "owner", text: "and BNB" },
    ]);
  });

  it("ends the running turn on a stop and drops the messages that waited", async () => {
    const started = createGate<undefined>();
    const rig = await startChatRig({
      mode: "after",
      replies: [callsReply([{ name: "wait" }])],
      tools: [waiter(() => started.open(undefined))],
    });
    const first = await rig.post("watch it");
    await started.promise;
    const second = await rig.post("and BNB");
    const stop = rig.engine.stop(rig.agent);
    await rig.received();
    await rig.runner.rested();
    expect(turnsStarted(rig)).toStrictEqual([first.turn]);
    expect(details(rig, "chat/turnEnded")).toStrictEqual(["stopped"]);
    expect(details(rig, "chat/status")).toStrictEqual(["turn.stopped"]);
    await expect(queued(rig, first.session, second.message)).resolves.toBeUndefined();
    expect(rig.engine.untaken()).toStrictEqual([]);
    expect(dropReasons(rig)).toStrictEqual({ [second.message]: "stopped", [stop]: "applied" });
  });

  it("closes a cleared session once its turn ended, and opens the next with a new message", async () => {
    const started = createGate<undefined>();
    const rig = await startChatRig({
      replies: [callsReply([{ name: "wait" }]), textReply("Fresh start.")],
      tools: [waiter(() => started.open(undefined))],
    });
    const first = await rig.post("watch it");
    await started.promise;
    const next = rig.engine.clear(rig.agent);
    await rig.received();
    await rig.runner.rested();
    const cleared = await rig.stores.sessions.get(first.session, live());
    expect(cleared?.clearedAtMs).toBeTypeOf("number");
    const again = await rig.post("again");
    await rig.runner.rested();
    expect(again.session).toBe(next);
    expect(rig.transport.requests[1]?.messages).toStrictEqual([{ role: "owner", text: "again" }]);
  });

  it("drops the messages of a turn the engine refuses for an archived agent", async () => {
    const rig = await startChatRig({ replies: [textReply("never")] });
    rig.engine.refuse(rig.agent, { started: false, refusal: "archived" });
    const posted = await rig.post("hi");
    await rig.runner.rested();
    expect(turnsStarted(rig)).toStrictEqual([]);
    await expect(queued(rig, posted.session, posted.message)).resolves.toBeUndefined();
    expect(rig.transport.requests).toHaveLength(0);
  });

  it("keeps the messages of a turn refused for a spent budget until it resumes", async () => {
    const rig = await startChatRig({ replies: [textReply("Back.")] });
    rig.engine.refuse(rig.agent, {
      started: false,
      refusal: "budget",
      resumesAt: rig.clock.now() + 60_000,
    });
    const posted = await rig.post("hi");
    await rig.runner.rested();
    await expect(queued(rig, posted.session, posted.message)).resolves.toBeDefined();
    rig.engine.refuse(rig.agent, undefined);
    await rig.clock.advance(60_000);
    await rig.runner.rested();
    expect(turnsStarted(rig)).toStrictEqual([posted.turn]);
  });

  it("starts a turn from a schedule's wake-up, marked when its schedule was", async () => {
    const rig = await startChatRig({ replies: [textReply("Reviewed.")] });
    const due = Date.parse("2027-01-15T14:00:00Z");
    const woke = rig.engine.due(rig.agent, {
      prompt: "Review my portfolio.",
      due,
      outsideContent: true,
    });
    await rig.received();
    await rig.runner.rested();
    expect(turnsStarted(rig)).toStrictEqual([woke.turn]);
    const [request] = rig.transport.requests;
    const text = `Schedule ${woke.schedule}, due at 2027-01-15T14:00:00.000Z, runs now: Review my portfolio.`;
    expect(request?.messages).toStrictEqual([{ role: "owner", text }]);
    const events = await rig.stores.transcript.events(
      { sessionId: woke.session, limit: 10 },
      live(),
    );
    expect(events.map(({ role, outside }) => [role, outside])).toStrictEqual([
      ["owner", true],
      ["agent", false],
    ]);
  });

  it("skips a schedule's wake-up refused for a spent budget, and keeps the owner's message", async () => {
    const rig = await startChatRig({ replies: [textReply("Back.")] });
    rig.engine.refuse(rig.agent, {
      started: false,
      refusal: "budget",
      resumesAt: rig.clock.now() + 60_000,
    });
    const woke = rig.engine.due(rig.agent, { prompt: "Review.", due: 1, outsideContent: false });
    await rig.received();
    await rig.runner.rested();
    const posted = await rig.post("hi");
    await rig.runner.rested();
    expect(dropReasons(rig)).toStrictEqual({ [woke.message]: "budget" });
    rig.engine.refuse(rig.agent, undefined);
    await rig.clock.advance(60_000);
    await rig.runner.rested();
    expect(turnsStarted(rig)).toStrictEqual([posted.turn]);
  });

  it("takes a message pushed twice once", async () => {
    const rig = await startChatRig({ replies: [textReply("Once."), textReply("Twice.")] });
    const seen: InboxMessageView[] = [];
    rig.engine.watchInbox({
      onMessage: (view) => seen.push(view),
      refetch: async () => Promise.resolve(),
    });
    await rig.post("hi");
    await Promise.all(seen.map(async (view) => rig.runner.receive(view)));
    await rig.runner.rested();
    expect(turnsStarted(rig)).toHaveLength(1);
    expect(details(rig, "chat/message")).toStrictEqual(["Once."]);
  });

  it("starts a turn at a restart with a message the chat queue still holds", async () => {
    const before = await startChatRig({ replies: [] });
    before.engine.refuse(before.agent, { started: false, refusal: "budget" });
    const posted = await before.post("hi");
    await before.runner.rested();
    before.engine.refuse(before.agent, undefined);
    const restarted = await createMemoryAgentStores(before.database);
    const after = await startChatRig({
      replies: [textReply("Back.")],
      restarted,
      engine: before.engine,
    });
    await after.runner.resume();
    await after.runner.rested();
    expect(turnsStarted(after)).toStrictEqual([posted.turn]);
    expect(details(after, "chat/message")).toStrictEqual(["Back."]);
  });

  it("applies at a restart a stop the chat queue holds unapplied", async () => {
    const before = await startChatRig({ replies: [] });
    before.engine.refuse(before.agent, { started: false, refusal: "budget" });
    const posted = await before.post("hi");
    await before.runner.rested();
    const stop = {
      kind: "inbox/stop" as const,
      message: nthTestId("msg", 77),
      agent: before.agent,
      session: posted.session,
      at: 2,
      reason: "owner" as const,
    };
    const draft = {
      message: stop.message,
      agentId: before.agent,
      sessionId: posted.session,
      kind: stop.kind,
    };
    await before.stores.queue.add(
      { ...draft, payload: payloadOf(stop), receivedAtMs: 99_999, fence: before.stores.fence },
      live(),
    );
    before.engine.refuse(before.agent, undefined);
    const restarted = await createMemoryAgentStores(before.database);
    const after = await startChatRig({
      replies: [textReply("never")],
      restarted,
      engine: before.engine,
    });
    await after.runner.resume();
    await after.runner.rested();
    expect(turnsStarted(after)).toStrictEqual([]);
    expect(dropReasons(after)).toStrictEqual({
      [posted.message]: "stopped",
      [stop.message]: "applied",
    });
  });

  it("takes the waiting messages into a turn through the first that holds images", async () => {
    const gate = createGate<undefined>();
    const held: ScriptedReply = async function* held() {
      await gate.promise;
      yield* textReply("one");
    };
    const rig = await startChatRig({ mode: "after", replies: [held, textReply("three")] });
    const first = await rig.post("hi");
    const second = await rig.post("look");
    await rig.post("this", ["tg:chart"]);
    const fourth = await rig.post("and BNB");
    gate.open(undefined);
    await rig.runner.rested();
    expect(turnsStarted(rig)).toStrictEqual([first.turn, second.turn, fourth.turn]);
  });
});
