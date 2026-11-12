import { fileURLToPath } from "node:url";
import type { ProtocolClient } from "@binference/client";
import { createFormatter } from "@binference/i18n";
import { startNodeProgram } from "@binference/platform";
import type { AgentView, PushFrame } from "@binference/protocol";
import { startInProcessRuntime } from "@binference/runtime/testing";
import { afterEach, describe, expect, it } from "vitest";
import type { StartRuntime } from "../agent-runtime/start-runtime.js";
import { runCli } from "../program/run-cli.js";
import { createScriptedPrompter } from "../term/scripted-prompter.js";
import type { InitMachine } from "./init-fixtures.js";
import { connectClient, hostWith, runOn } from "./test-host.js";
import { createRunningEngines } from "./unlock-fixtures.js";

// `binference chat delete` end to end (decision 0415): the engine `binference start` runs, the
// agent runtime as a process of its own from source with its agent.sqlite and a scripted model,
// and the command's question, words and answer in English and Chinese.
const slow = { timeout: 60_000 };
const engines = createRunningEngines();
const live = (): { readonly signal: AbortSignal } => ({ signal: AbortSignal.timeout(20_000) });
const entry = fileURLToPath(new URL("scripted-runtime.entry.ts", import.meta.url));
const loader = ["--conditions=@binference/source", "--import", "tsx"];
const scriptedRuntime: StartRuntime = async (signal) =>
  startNodeProgram({ args: [...loader, entry], parentEnv: {}, signal });
// A runtime whose sign-in never ends, so the engine holds it down.
const downRuntime: StartRuntime = async () => startInProcessRuntime({ hangsAtSignIn: true });
const zh = createFormatter({ locale: "zh", timeZone: "UTC" });

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

// The pushes on the agent's chat topic, and one that settles at each kind the test waits for.
function watchChat(client: ProtocolClient, agent: AgentView["agent"]) {
  const pushes: PushFrame[] = [];
  const waiters: { readonly kind: string; readonly resolve: () => void }[] = [];
  client.subscribe(`chat:${agent}`, {
    onPush: (push) => {
      pushes.push(push);
      waiters.filter(({ kind }) => kind === push.kind).forEach(({ resolve }) => resolve());
    },
    refetch: async () => Promise.resolve(),
  });
  const next = async (kind: string): Promise<void> =>
    new Promise((resolve) => waiters.push({ kind, resolve }));
  return { pushes, next };
}

// A started engine whose agent answered the owner's "hi" once.
async function chattedEngine() {
  const machine = await engines.setUp();
  await engines.start(machine, { parts: { startRuntime: scriptedRuntime } });
  const client = await connectClient(machine);
  const agent = firstAgent((await client.call("agent/list", {}, live())).items);
  const chat = watchChat(client, agent);
  const ended = chat.next("chat/turnEnded");
  const posted = await client.call("chat/post", { agent, text: "hi" }, live());
  await ended;
  return { machine, client, agent, chat, posted };
}

// `binference chat delete` with a person at the terminal who types `typed`.
async function deleteAtTerminal(machine: InitMachine, typed: readonly string[]) {
  const prompter = createScriptedPrompter({ chatDeleteConfirm: typed });
  const host = hostWith(machine, ["chat", "delete"], { env: {}, parts: { prompter } });
  const code = await runCli(host);
  return { code, stdout: host.stdout(), stderr: host.stderr(), lines: prompter.transcript.lines };
}

describe("binference chat delete", () => {
  it(
    "deletes the agent's chat once the phrase is typed, and its next message starts a new one",
    slow,
    async () => {
      const { machine, client, agent, chat, posted } = await chattedEngine();
      const deletedPush = chat.next("chat/deleted");
      const deleted = await deleteAtTerminal(machine, ["yes", "delete chats"]);
      expect(deleted.code).toBe(0);
      expect(deleted.lines).toStrictEqual([
        "Type delete chats to go on, or press Ctrl+C to keep the chats.",
      ]);
      expect(deleted.stdout).toContain(
        "Deleted 1 chat of 1 agent, with 2 messages, 1 turn, 0 goals, 0 progress notes and 0 helpers, and closed 0 open questions.",
      );
      expect(deleted.stdout).toContain("Backups made before now still hold these chats");
      await deletedPush;
      expect(chat.pushes.at(-1)).toMatchObject({ kind: "chat/deleted", data: { agent } });
      await expect(client.call("chat/messages", { agent }, live())).resolves.toStrictEqual({
        items: [],
      });
      const ended = chat.next("chat/turnEnded");
      const again = await client.call("chat/post", { agent, text: "again" }, live());
      await ended;
      expect(again.session).not.toBe(posted.session);
      // The scripted model answers once, so the new chat holds the owner's message alone.
      const kept = await client.call("chat/messages", { agent }, live());
      expect(kept.items.map(({ session, text }) => [session, text])).toStrictEqual([
        [again.session, "again"],
      ]);
    },
  );

  it("asks in Chinese, and with nobody to answer refuses and deletes nothing", slow, async () => {
    const { machine, client, agent } = await chattedEngine();
    const refused = await runOn(machine, ["chat", "delete", "--agent", agent]);
    expect(refused.code).toBe(1);
    expect(refused.stderr).toContain("binference chat delete asks you to type delete chats first.");
    const before = await client.call("chat/messages", { agent }, live());
    expect(before.items).toHaveLength(2);
    const chinese = await runOn(machine, ["config", "set", "owner.locale", "zh"]);
    expect(chinese.code).toBe(0);
    const phrase = zh.message("cli.chatDelete.phrase");
    const deleted = await deleteAtTerminal(machine, ["yes", phrase]);
    expect([deleted.code, deleted.stderr]).toStrictEqual([0, ""]);
    expect(deleted.lines).toStrictEqual([zh.message("cli.chatDelete.ask", { phrase })]);
    const counts = { agents: 1, sessions: 1, events: 2, turns: 1, questions: 0, goals: 0 };
    const done = { ...counts, progressNotes: 0, helpers: 0 };
    expect(deleted.stdout).toBe(`${zh.message("cli.chatDelete.done", done)}\n`);
    await expect(client.call("chat/messages", { agent }, live())).resolves.toStrictEqual({
      items: [],
    });
  });

  it(
    "refuses while the agent runtime is down, with the words to start binference",
    slow,
    async () => {
      const machine = await engines.setUp();
      await engines.start(machine, { parts: { startRuntime: downRuntime } });
      const refused = await runOn(machine, ["chat", "delete", "--yes"]);
      expect(refused.code).toBe(1);
      expect(refused.stderr).toContain(
        "Your agent is offline, so its chats cannot be deleted now.",
      );
    },
  );

  it("answers the counts as JSON with --yes", slow, async () => {
    const { machine, agent } = await chattedEngine();
    const deleted = await runOn(machine, ["chat", "delete", "--yes", "--json"]);
    expect(deleted.code).toBe(0);
    expect(JSON.parse(deleted.stdout)).toStrictEqual({
      agents: [agent],
      sessions: 1,
      turns: 1,
      events: 2,
      messages: 1,
      goals: 0,
      progressNotes: 0,
      helpers: 0,
      inboxMessages: 1,
      questions: 0,
    });
  });
});
