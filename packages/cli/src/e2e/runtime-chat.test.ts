import { fileURLToPath } from "node:url";
import type { ProtocolClient } from "@binference/client";
import { startNodeProgram } from "@binference/platform";
import type { AgentView, PushFrame } from "@binference/protocol";
import { afterEach, describe, expect, it } from "vitest";
import type { StartRuntime } from "../agent-runtime/start-runtime.js";
import { connectClient } from "./test-host.js";
import { createRunningEngines } from "./unlock-fixtures.js";

// The chat relay end to end: an owner's chat/post through the engine `binference start` runs, to
// the agent runtime as a process of its own from source, with its agent.sqlite and a scripted
// model, and the turn's text and end back on the agent's chat topic.
const slow = { timeout: 60_000 };
const engines = createRunningEngines();
const live = (): { readonly signal: AbortSignal } => ({ signal: AbortSignal.timeout(20_000) });
const entry = fileURLToPath(new URL("scripted-runtime.entry.ts", import.meta.url));
const loader = ["--conditions=@binference/source", "--import", "tsx"];

afterEach(async () => {
  await engines.stopAll();
});

// The agent `binference init` made.
function firstAgent(items: readonly AgentView[]): AgentView["agent"] {
  const [first] = items;
  if (first === undefined) {
    throw new Error("binference init made no agent.");
  }
  return first.agent;
}

// The pushes on the agent's chat topic, and a promise that settles at the first turn's end.
function watchChat(client: ProtocolClient, agent: AgentView["agent"]) {
  const pushes: PushFrame[] = [];
  const ended = new Promise<void>((resolve) => {
    client.subscribe(`chat:${agent}`, {
      onPush: (push) => {
        pushes.push(push);
        if (push.kind === "chat/turnEnded") {
          resolve();
        }
      },
      refetch: async () => Promise.resolve(),
    });
  });
  return { pushes, ended };
}

const scriptedRuntime: StartRuntime = async (signal) =>
  startNodeProgram({ args: [...loader, entry], parentEnv: {}, signal });

describe("the chat relay to the agent runtime process", () => {
  it("takes an owner's message from chat/post to the turn's end", slow, async () => {
    const machine = await engines.setUp();
    await engines.start(machine, { parts: { startRuntime: scriptedRuntime } });
    const client = await connectClient(machine);
    const id = firstAgent((await client.call("agent/list", {}, live())).items);
    const { pushes, ended } = watchChat(client, id);
    const posted = await client.call("chat/post", { agent: id, text: "hi" }, live());
    await ended;
    expect(pushes.map(({ kind, data }) => [kind, data])).toStrictEqual([
      ["chat/turnStarted", { agent: id, session: posted.session, turn: posted.turn }],
      [
        "chat/message",
        {
          agent: id,
          session: posted.session,
          turn: posted.turn,
          text: "Hello from the agent.",
          final: true,
        },
      ],
      ["chat/turnEnded", { agent: id, turn: posted.turn, outcome: "ok" }],
    ]);
  });
});
