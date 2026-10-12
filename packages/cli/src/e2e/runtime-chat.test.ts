import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ProtocolClient } from "@binference/client";
import { realFilePath, startNodeProgram, writePrivateFile } from "@binference/platform";
import type { AgentView, PushFrame } from "@binference/protocol";
import { type StandInModelServer, startStandInModelServer } from "@binference/runtime/testing";
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import type { StartRuntime } from "../agent-runtime/start-runtime.js";
import { configText, type InitMachine, secretEnv } from "./init-fixtures.js";
import { connectClient, noPermissions } from "./test-host.js";
import { createRunningEngines } from "./unlock-fixtures.js";

// The chat relay end to end: an owner's chat/post through the engine `binference start` runs, to
// the agent runtime as a process of its own from source, with its agent.sqlite and a model, and
// the turn's text and end back on the agent's chat topic. The model is a scripted one, or the
// runtime's own Chat Completions client against a stand-in provider on the loopback.
const slow = { timeout: 60_000 };
const engines = createRunningEngines();
const servers: StandInModelServer[] = [];
const live = (): { readonly signal: AbortSignal } => ({ signal: AbortSignal.timeout(20_000) });
const entry = fileURLToPath(new URL("scripted-runtime.entry.ts", import.meta.url));
const loader = ["--conditions=@binference/source", "--import", "tsx"];

afterEach(async () => {
  await engines.stopAll();
  await Promise.all(servers.splice(0).map(async (server) => server.close()));
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

// Every variable the official client would read, pointing somewhere else: none may change a call.
const strayEnv = {
  OPENAI_BASE_URL: "http://127.0.0.1:9/v1",
  OPENAI_API_KEY: "sk-stray",
  OPENAI_ADMIN_KEY: "sk-admin-stray",
  OPENAI_ORG_ID: "org-stray",
  OPENAI_PROJECT_ID: "proj_stray",
  OPENAI_WEBHOOK_SECRET: "whsec_stray",
  OPENAI_LOG: "debug",
  OPENAI_CUSTOM_HEADERS: "x-stray: 1",
};

// The runtime binference ships, from its source, started with the stray variables above.
const realRuntime: StartRuntime = async (signal) => {
  const linked = fileURLToPath(import.meta.resolve("@binference/runtime/process"));
  const program = await realFilePath(linked, signal);
  return startNodeProgram({ args: [...loader, program], parentEnv: {}, env: strayEnv, signal });
};

const sse = (chunk: object): string => `data: ${JSON.stringify(chunk)}\n\n`;
const chunk = (delta: object, finish: string | null = null) => ({
  id: "chatcmpl-E2E",
  object: "chat.completion.chunk",
  created: 1_760_000_000,
  model: "stand-in-model",
  choices: [{ index: 0, delta, finish_reason: finish }],
});

// A provider that answers one streamed text, its usage last.
async function standInProvider(): Promise<StandInModelServer> {
  const usage = { prompt_tokens: 20, completion_tokens: 5, total_tokens: 25 };
  const server = await startStandInModelServer([
    {
      status: 200,
      headers: { "content-type": "text/event-stream" },
      chunks: [
        sse(chunk({ role: "assistant", content: "" })),
        sse(chunk({ content: "Hello from the model." })),
        sse(chunk({}, "stop")),
        sse({ ...chunk({}), choices: [], usage }),
        "data: [DONE]\n\n",
      ],
    },
  ]);
  servers.push(server);
  return server;
}

// The tools a request to the model declares, by name.
const toolsSchema = z.object({
  tools: z.array(z.object({ function: z.object({ name: z.string() }) })),
});

// The parts of a Chat Completions request a turn's context fills: the stable prefix as the system
// message, the history, then the live facts.
const contextSchema = z.object({
  model: z.string(),
  max_completion_tokens: z.int(),
  stream: z.boolean(),
  messages: z.array(z.object({ role: z.string(), content: z.string() })),
});

// The first request the stand-in received: its model, output limit and stream flag, each message's
// role, and the texts of the system message, the owner's message and the live facts.
function firstCall(server: StandInModelServer) {
  const [body = "{}"] = server.requests.map((request) => request.body);
  const call = contextSchema.parse(JSON.parse(body));
  const [system, owner, facts] = call.messages.map((message) => message.content);
  return {
    head: [call.model, call.max_completion_tokens, call.stream],
    roles: call.messages.map((message) => message.role),
    system,
    owner,
    facts,
  };
}

// Points the machine's main model at the stand-in, its key read from the engine's environment,
// with a second configured model as its fallback.
async function useProvider(machine: InitMachine, server: StandInModelServer): Promise<void> {
  const text = (await configText(machine)) ?? "";
  const open = text.indexOf("{");
  const models =
    `\n  models: { providers: { local: { kind: "openai", baseUrl: "${server.origin}/v1", ` +
    `apiKey: { fromEnv: "LOCAL_MODEL_KEY" } } }, main: "local/stand-in-model", ` +
    `fallbacks: { main: ["local/picked-model"] } },`;
  await writePrivateFile(
    join(machine.folder, "config.json5"),
    `${text.slice(0, open + 1)}${models}${text.slice(open + 1)}`,
    { permissions: noPermissions, signal: AbortSignal.timeout(5_000) },
  );
}

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

  it(
    "runs the turn on the runtime's own model client against a stand-in provider",
    slow,
    async () => {
      const machine = await engines.setUp();
      const server = await standInProvider();
      await useProvider(machine, server);
      const env = { ...secretEnv(machine), LOCAL_MODEL_KEY: "sk-stand-in" };
      await engines.start(machine, { env, parts: { startRuntime: realRuntime } });
      const client = await connectClient(machine);
      const id = firstAgent((await client.call("agent/list", {}, live())).items);
      const { pushes, ended } = watchChat(client, id);
      const posted = await client.call("chat/post", { agent: id, text: "hi" }, live());
      await ended;
      expect(pushes.map(({ kind, data }) => [kind, data]).slice(1)).toStrictEqual([
        [
          "chat/message",
          {
            agent: id,
            session: posted.session,
            turn: posted.turn,
            text: "Hello from the model.",
            final: true,
          },
        ],
        ["chat/turnEnded", { agent: id, turn: posted.turn, outcome: "ok" }],
      ]);
      expect(
        server.requests.map(({ method, path, headers }) => [
          method,
          path,
          headers["authorization"],
          headers["user-agent"],
          Object.keys(headers).toSorted(),
        ]),
      ).toStrictEqual([
        [
          "POST",
          "/v1/chat/completions",
          "Bearer sk-stand-in",
          expect.stringMatching(/^binference\//),
          [
            "accept",
            "authorization",
            "connection",
            "content-length",
            "content-type",
            "host",
            "user-agent",
          ],
        ],
      ]);
      const call = firstCall(server);
      expect(call.head).toStrictEqual(["stand-in-model", 4096, true]);
      expect(call.roles).toStrictEqual(["system", "user", "user"]);
      expect(call.system).toMatch(/^You are a binference agent/u);
      expect(call.system).toContain('<workspace-file name="RULES.md">\n# Rules\n');
      expect(call.system).toContain('<workspace-file name="FIRST-CHAT.md">');
      expect(call.owner).toBe("hi");
      expect(call.facts).toMatch(/^Live facts from binference.+\n- Mode: paper\./su);
      const [sent] = server.requests.map(({ body }) => toolsSchema.parse(JSON.parse(body)));
      expect(sent?.tools.map((tool) => tool.function.name)).toStrictEqual([
        "token_search",
        "portfolio",
        "token_info",
        "token_risk",
        "quote",
        "orders",
        "tx_status",
        "swap",
        "buy",
        "sell",
        "order_create",
        "order_cancel",
      ]);
    },
  );

  it("runs the next turn on the model the owner picked with model/set", slow, async () => {
    const machine = await engines.setUp();
    const server = await standInProvider();
    await useProvider(machine, server);
    const env = { ...secretEnv(machine), LOCAL_MODEL_KEY: "sk-stand-in" };
    await engines.start(machine, { env, parts: { startRuntime: realRuntime } });
    const client = await connectClient(machine);
    const id = firstAgent((await client.call("agent/list", {}, live())).items);
    const pick = { agent: id, role: "main", model: "local/picked-model" } as const;
    const models = await client.call("model/set", pick, live());
    expect(
      models.items.filter((item) => item.current === true).map((item) => item.model),
    ).toStrictEqual(["local/picked-model"]);
    const { ended } = watchChat(client, id);
    await client.call("chat/post", { agent: id, text: "hi" }, live());
    await ended;
    expect(firstCall(server).head).toStrictEqual(["picked-model", 4096, true]);
    expect(server.requests).toHaveLength(1);
  });
});
