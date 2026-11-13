import { createManualClock } from "@binference/core/testing";
import {
  createMemoryAgentDatabase,
  createMemoryTranscriptStore,
  type MemoryAgentDatabase,
} from "@binference/store/testing";
import { describe, expect, it } from "vitest";
import { engineLineSchema, runtimeLineSchema } from "../control/control-line.schema.js";
import { readControlLines } from "../control/read-control-lines.js";
import { createGate, type TestTool } from "../loop/test-turns.js";
import { loadConversation } from "../sessions/conversation.js";
import { proposalUnknownAfterRestart } from "../sessions/repair-turns.js";
import { createSessionJournal } from "../sessions/session-journal.js";
import {
  startInProcessRuntime,
  type InProcessRuntimeOptions,
} from "../testing/in-process-runtime.js";
import { listedServerFixture } from "../testing/listing-fixture.js";
import { createMemoryAgentStores, nthTestId } from "../testing/memory-agent-stores.js";
import { createMemoryEngineChat, type MemoryEngineChat } from "../testing/memory-engine-chat.js";
import { callsReply, textReply } from "../testing/scripted-transport.js";
import { fixtureStartLine } from "../testing/start-line-fixture.js";

const agent = nthTestId("agt", 1);
const live = (): AbortSignal => new AbortController().signal;

// Starts a runtime, sends its start line and settles once it wrote `ready`.
async function ready(options: InProcessRuntimeOptions) {
  const runtime = startInProcessRuntime(options);
  const lines = readControlLines(runtime.output)[Symbol.asyncIterator]();
  await runtime.write(`${JSON.stringify(engineLineSchema.encode(fixtureStartLine()))}\n`);
  const first = await lines.next();
  expect(
    runtimeLineSchema.parse(JSON.parse(first.done === true ? "{}" : first.value)),
  ).toMatchObject({ t: "ready" });
  return runtime;
}

async function endedTurn(engine: MemoryEngineChat, turn: string): Promise<string | undefined> {
  const push = await engine.waitForPush(
    (each) => each.kind === "chat/turnEnded" && each.turn === turn,
  );
  return push.detail;
}

// A propose tool that reaches the engine and never hears back, as when the runtime dies mid-call.
function hangingSwap(sends: string[], sent: () => void): TestTool {
  return {
    name: "swap",
    kind: "propose",
    run: async ({ idempotencyKey }) => {
      sends.push(idempotencyKey);
      sent();
      return new Promise(() => undefined);
    },
  };
}

// Reads the transcript as the next turn loads it, without raising the fence of the running runtime.
async function toolResults(
  database: MemoryAgentDatabase,
  session: Parameters<typeof loadConversation>[1],
) {
  const loaded = await loadConversation(createMemoryTranscriptStore(database), session, live());
  return loaded.messages.filter((message) => message.role === "tool");
}

describe("the runtime's chat", () => {
  it("takes the messages waiting in the engine at its start and runs their turn", async () => {
    const engine = createMemoryEngineChat([agent]);
    const posted = engine.post(agent, "hi");
    await ready({ engine, replies: [textReply("Hello.")] });
    await expect(endedTurn(engine, posted.turn)).resolves.toBe("ok");
    expect(
      engine.pushes.filter((push) => push.kind === "chat/message").map((push) => push.detail),
    ).toStrictEqual(["Hello."]);
    expect(engine.untaken()).toStrictEqual([]);
  });

  it("repairs a turn a crash left and tells the engine it ended before ready", async () => {
    const database = createMemoryAgentDatabase();
    const { stores } = await createMemoryAgentStores(database);
    const session = nthTestId("ses", 1);
    const turn = nthTestId("trn", 1);
    const { fence } = stores;
    const open = {
      id: session,
      agentId: agent,
      surface: "cli",
      conversation: "cli",
      startedAtMs: 1,
    };
    await stores.sessions.open({ ...open, fence }, { signal: live() });
    await stores.sessions.startTurn(
      { id: turn, sessionId: session, startedAtMs: 2, outsideContent: false, fence },
      { signal: live() },
    );
    const journal = createSessionJournal(stores, { session, turn }, createManualClock(3));
    await journal.response({ text: "Buying", reasoning: "" }, live());
    await journal.proposal(
      { call: { id: "c1", name: "swap", argumentsText: "{}" }, idempotencyKey: `${turn}.1` },
      live(),
    );
    const engine = createMemoryEngineChat([agent]);
    await ready({ engine, database });
    expect(engine.pushes.map((push) => [push.kind, push.detail])).toStrictEqual([
      ["chat/status", "turn.failed.proposalUnknown"],
      ["chat/turnEnded", "failed"],
    ]);
    await expect(toolResults(database, session)).resolves.toStrictEqual([
      {
        role: "tool",
        callId: "c1",
        name: "swap",
        text: proposalUnknownAfterRestart,
        isError: true,
      },
    ]);
  });

  it("after a restart in the middle of a turn, every call has a result and nothing is proposed again", async () => {
    const engine = createMemoryEngineChat([agent]);
    const database = createMemoryAgentDatabase();
    const sends: string[] = [];
    const sent = createGate<undefined>();
    const tools = [
      hangingSwap(sends, () => sent.open(undefined)),
      { name: "quote", kind: "read" as const },
    ];
    const first = await ready({
      engine,
      database,
      tools,
      replies: [
        callsReply([
          { id: "c1", name: "quote" },
          { id: "c2", name: "swap" },
        ]),
      ],
    });
    const posted = engine.post(agent, "buy it");
    await sent.promise;
    first.kill();
    const replies = [textReply("I could not confirm the swap; check your open cards.")];
    await ready({ engine, database, tools, replies });
    await expect(endedTurn(engine, posted.turn)).resolves.toBe("failed");
    expect(
      engine.pushes.filter((push) => push.kind === "chat/status").map((push) => push.detail),
    ).toStrictEqual(["turn.failed.proposalUnknown"]);
    await expect(toolResults(database, posted.session)).resolves.toStrictEqual([
      { role: "tool", callId: "c1", name: "quote", text: "ran quote", isError: false },
      {
        role: "tool",
        callId: "c2",
        name: "swap",
        text: proposalUnknownAfterRestart,
        isError: true,
      },
    ]);
    const again = engine.post(agent, "what happened?");
    await expect(endedTurn(engine, again.turn)).resolves.toBe("ok");
    expect(sends).toStrictEqual([`${posted.turn}.2`]);
  });

  it("starts every turn marked while the settings offer a community plugin's tools", async () => {
    const engine = createMemoryEngineChat([agent]);
    const seen: (boolean | undefined)[] = [];
    const look: TestTool = {
      name: "look",
      kind: "read",
      run: async () => {
        seen.push(engine.running(agent)?.marked);
        return Promise.resolve({ text: "looked", isError: false });
      },
    };
    const replies = [callsReply([{ id: "c1", name: "look" }]), textReply("Done.")];
    const runtime = await ready({ engine, replies, tools: [look] });
    const { settings } = fixtureStartLine();
    const plugins = [
      {
        plugin: "plg_0192b3c4-d5e6-7f80-9a1b-2c3d4e5f6a7b",
        id: "fear-index",
        tools: [{ name: "index", description: "The index.", input: { type: "object" } }],
      },
    ];
    await runtime.write(
      `${JSON.stringify(engineLineSchema.encode({ t: "settings", settings: { ...settings, plugins } }))}\n`,
    );
    const posted = engine.post(agent, "hi");
    await expect(endedTurn(engine, posted.turn)).resolves.toBe("ok");

    expect(seen).toStrictEqual([true]);
  });

  it.each([
    ["on for the agent", [agent], [true]],
    ["on for another agent only", [nthTestId("agt", 9)], [false]],
  ])(
    "starts a turn marked while a listed MCP server is %s, and clean otherwise",
    async (_name, agents, marks) => {
      const engine = createMemoryEngineChat([agent]);
      const seen: (boolean | undefined)[] = [];
      const look: TestTool = {
        name: "look",
        kind: "read",
        run: async () => {
          seen.push(engine.running(agent)?.marked);
          return Promise.resolve({ text: "looked", isError: false });
        },
      };
      const replies = [callsReply([{ id: "c1", name: "look" }]), textReply("Done.")];
      const runtime = await ready({ engine, replies, tools: [look] });
      const { settings } = fixtureStartLine();
      const listedMcp = [listedServerFixture(agents)];
      await runtime.write(
        `${JSON.stringify(engineLineSchema.encode({ t: "settings", settings: { ...settings, listedMcp } }))}\n`,
      );
      const posted = engine.post(agent, "hi");
      await expect(endedTurn(engine, posted.turn)).resolves.toBe("ok");

      expect(seen).toStrictEqual(marks);
    },
  );

  it("names in its health line each agent's listing that rests or has a tool off", async () => {
    const listing = nthTestId("mls", 1);
    const states = [{ agent, listing, state: "off" as const, reason: "changed", tool: "rate" }];
    const runtime = startInProcessRuntime({ listedMcpStates: () => states });
    const lines = readControlLines(runtime.output)[Symbol.asyncIterator]();
    await runtime.write(`${JSON.stringify(engineLineSchema.encode(fixtureStartLine()))}\n`);
    await lines.next();
    await runtime.tick();
    const health = await lines.next();

    expect(runtimeLineSchema.parse(JSON.parse(String(health.value)))).toMatchObject({
      t: "health",
      listedMcp: states,
    });
  });

  it("sets up the turn after a settings line with the model the owner picked", async () => {
    const engine = createMemoryEngineChat([agent]);
    const runtime = await ready({ engine, replies: [textReply("One."), textReply("Two.")] });
    const first = engine.post(agent, "hi");
    await expect(endedTurn(engine, first.turn)).resolves.toBe("ok");
    const { settings } = fixtureStartLine();
    const picked = {
      ...settings,
      models: { ...settings.models, picked: { [agent]: { main: "router/picked" } } },
    };
    await runtime.write(
      `${JSON.stringify(engineLineSchema.encode({ t: "settings", settings: picked }))}\n`,
    );
    const second = engine.post(agent, "again");
    await expect(endedTurn(engine, second.turn)).resolves.toBe("ok");
    expect(
      runtime.setups.map((setup) => setup.settings.models.picked?.[agent]?.main),
    ).toStrictEqual([undefined, "router/picked"]);
  });
});
