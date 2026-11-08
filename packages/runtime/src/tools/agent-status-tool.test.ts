import { BinferenceError, idSchema } from "@binference/core";
import type { HelperRecord } from "@binference/store";
import { describe, expect, it } from "vitest";
import type { RuntimeModels } from "../control/runtime-settings.schema.js";
import type { ToolBox } from "../loop/ports.js";
import type { ToolOutcome, ToolRunContext } from "../loop/turn-records.js";
import { agent, context, toolTurn } from "../testing/agent-tool-fixtures.js";
import { createFakeToolClient, type FakeAnswer } from "../testing/fake-tool-client.js";
import type { ChatStanding } from "./agent-status-answer.js";
import type { AgentStatusParts, ChatStatusSource } from "./agent-status-tool.js";
import { agentToolBox, helperToolBox } from "./agent-tools.js";
import type { AgentToolParts } from "./tool-client.js";

// 2026-11-08 17:40 in Berlin, a day that started at 00:00 there (23:00 UTC the day before).
const nowMs = Date.UTC(2026, 10, 8, 16, 40);
const startedAtMs = Date.UTC(2026, 10, 8, 8, 5);

const models: RuntimeModels = {
  providers: { router: { kind: "binference" } },
  main: "router/main",
  fast: "router/fast",
  imageInput: [],
  fallbacks: { main: [], fast: [] },
  idleTimeoutMs: 120_000,
  cooldownMs: 60_000,
  maxToolCallsPerTurn: 25,
  loopDetection: true,
  prices: {},
};

const answers: Readonly<Record<string, FakeAnswer>> = {
  "agent/get": { agent, name: "Scout", mode: "paper", locale: "en", createdAt: 1, changedAt: 1 },
  "facts/get": {
    agent,
    at: nowMs,
    timeZone: "Europe/Berlin",
    mode: "paper",
    frozen: false,
    approvalMode: "manual",
    sendLevel: 3,
    orders: [],
    spentTodayUsdMicros: "0",
    perTradeUsdMicros: "50000000",
    rollingDayUsdMicros: "500000000",
    assets: {},
  },
  "usage/get": {
    rows: [
      {
        agent,
        dayAt: nowMs,
        model: "router/main",
        inputTokens: 1,
        outputTokens: 1,
        cachedTokens: 0,
        usdMicros: "420000",
      },
      {
        agent,
        dayAt: nowMs,
        model: "router/fast",
        inputTokens: 1,
        outputTokens: 1,
        cachedTokens: 0,
        usdMicros: "80000",
      },
    ],
    budgets: [{ agent, dailyUsdMicros: "3000000", leftUsdMicros: "2500000" }],
  },
};

function helper(label: string, state: HelperRecord["state"], n: number): HelperRecord {
  const id = idSchema("ses").parse(`ses_0190f1c2-3a4b-7c5d-8e6f-00000000010${String(n)}`);
  return {
    id,
    agentId: agent,
    parentSessionId: toolTurn.session,
    label,
    state,
    startedAtMs,
    ...(state === "running" ? {} : { endedAtMs: startedAtMs + 1 }),
    timeoutMs: 600_000,
    runs: 1,
    outside: false,
  };
}

function neverCalled(): never {
  throw new BinferenceError({ code: "runtime.tool_invalid", message: "Not called here." });
}

/** A chat source over one session, recording each chat model it was asked to set. */
function chatsOf(options: {
  readonly chat?: ChatStanding;
  readonly sets?: boolean;
  readonly open?: boolean;
}): { readonly source: ChatStatusSource; readonly set: (string | undefined)[] } {
  const set: (string | undefined)[] = [];
  const read: ChatStatusSource["read"] = async () =>
    options.chat === undefined ? Promise.reject(new Error("unread")) : options.chat;
  const source: ChatStatusSource = {
    read,
    budgetLeft: () => 1_250_000n,
    ...(options.sets === false
      ? {}
      : {
          setModel: async (change) => {
            set.push(change.model);
            return Promise.resolve(options.open ?? true);
          },
        }),
  };
  return { source, set };
}

function partsOf(
  source: ChatStatusSource,
  replies: Readonly<Record<string, FakeAnswer>> = answers,
): AgentToolParts {
  const status: AgentStatusParts = {
    chats: source,
    settings: { models, owner: { locale: "en", timezone: "Europe/Berlin" } },
    version: "2026.11.8",
    clock: { now: () => nowMs, sleep: neverCalled },
  };
  const desk = {
    start: neverCalled,
    list: async () =>
      Promise.resolve([helper("scan launches", "running", 1), helper("check CAKE", "done", 2)]),
    read: neverCalled,
    send: neverCalled,
    stop: neverCalled,
  };
  return {
    agent,
    client: createFakeToolClient(replies),
    turn: toolTurn,
    status,
    helpers: { desk, clock: status.clock },
  };
}

const turnContext: ToolRunContext = {
  ...context,
  turnState: () => ({
    model: "router/main",
    outside: true,
    context: { usedTokens: 23_400, windowTokens: 128_000 },
  }),
};

async function callIn(box: ToolBox, args: object = {}): Promise<ToolOutcome> {
  const prepared = box.prepare({
    id: "c1",
    name: "agent_status",
    argumentsText: JSON.stringify(args),
  });
  if (!prepared.ready) {
    throw new Error(prepared.text);
  }
  return prepared.run(turnContext);
}

async function callStatus(parts: AgentToolParts, args: object = {}): Promise<ToolOutcome> {
  return callIn(agentToolBox(parts), args);
}

const chat: ChatStanding = { startedAtMs, turns: 14 };

describe("agent_status", () => {
  it("answers the agent, its models, spend, chat, helpers, version and time in one read", async () => {
    const outcome = await callStatus(partsOf(chatsOf({ chat }).source));
    expect(outcome).toStrictEqual({
      text: [
        `Agent: Scout (${agent}). Mode paper, not frozen, approval mode manual.`,
        "Models in force: main router/main, fast router/fast, vision none set, image making none set, video making none set, speech none set.",
        "Model spend today: $0.50 of the $3.00 daily budget, $2.50 left; it resets at Nov 9, 2026, 00:00:00.",
        "This chat: started Nov 8, 2026, 09:05:00, 14 turns so far, this one among them. This turn calls router/main. The context holds about 23k of 128k tokens (18%). This turn holds outside content, so its proposals carry a warning.",
        `Helpers: 1 running: "scan launches" (ses_0190f1c2-3a4b-7c5d-8e6f-000000000101); 1 more ended, which helper_list lists.`,
        "binference 2026.11.8. Now Nov 8, 2026, 17:40:00 (Europe/Berlin).",
      ].join("\n"),
      isError: false,
    });
  });

  it("says what it could not read, and the budget the engine last answered", async () => {
    const parts = partsOf(chatsOf({}).source, {});
    const { text } = await callStatus(parts);
    expect(text.split("\n").slice(0, 4)).toStrictEqual([
      "Agent: name could not be read now. Mode, freeze and approval mode could not be read now.",
      "Models in force: main router/main, fast router/fast, vision none set, image making none set, video making none set, speech none set.",
      "Model spend today could not be read now. $1.25 was left when binference last answered. The budget resets at Nov 9, 2026, 00:00:00.",
      "This chat: its start and turns could not be read now. This turn calls router/main. The context holds about 23k of 128k tokens (18%). This turn holds outside content, so its proposals carry a warning.",
    ]);
  });

  it("sets the chat model for the next turns, and default puts the configured one back", async () => {
    const chats = chatsOf({ chat: { ...chat, model: "router/big" } });
    const set = await callStatus(partsOf(chats.source), { model: "router/big" });
    expect(set.isError).toBe(false);
    expect(set.text.split("\n").slice(0, 3)).toStrictEqual([
      "This chat talks with router/big from its next turn until it is cleared; the daily model budget still caps its spend, and default puts the configured model back.",
      `Agent: Scout (${agent}). Mode paper, not frozen, approval mode manual.`,
      "Models in force: main router/main, fast router/fast, vision none set, image making none set, video making none set, speech none set. This chat talks with its own model, router/big.",
    ]);
    const cleared = await callStatus(partsOf(chats.source), { model: "default" });
    expect(cleared.text.split("\n")[0]).toBe(
      "This chat runs on the configured model again from its next turn.",
    );
    expect(chats.set).toStrictEqual(["router/big", undefined]);
  });

  it("refuses a model of a provider the settings do not configure, and sets nothing", async () => {
    const chats = chatsOf({ chat });
    const outcome = await callStatus(partsOf(chats.source), { model: "openai/gpt-5" });
    expect(outcome.isError).toBe(true);
    expect(outcome.text.split("\n")[0]).toBe(
      "not set: model must be <provider>/<model> of a provider the settings configure (router), or default.",
    );
    expect(chats.set).toStrictEqual([]);
  });

  it("says so when a clear closed the chat before its model was set", async () => {
    const chats = chatsOf({ chat, open: false });
    const outcome = await callStatus(partsOf(chats.source), { model: "router/big" });
    expect(outcome.isError).toBe(true);
    expect(outcome.text.split("\n")[0]).toBe(
      "not set: this chat was cleared; the next chat runs on the configured model.",
    );
  });

  it("names a stored chat model whose provider is gone as ignored", async () => {
    const stale = chatsOf({ chat: { ...chat, model: "openai/gpt-5" } });
    const { text } = await callStatus(partsOf(stale.source));
    expect(text.split("\n")[1]).toBe(
      "Models in force: main router/main, fast router/fast, vision none set, image making none set, video making none set, speech none set. This chat's model openai/gpt-5 is ignored: its provider is no longer in models.providers.",
    );
  });
});

describe("agent_status in a helper's turn", () => {
  it("is a read with no arguments, which never sets a model", async () => {
    const chats = chatsOf({ chat, sets: false });
    const { helpers: _helpers, ...helperParts } = partsOf(chats.source);
    const box = helperToolBox(helperParts);
    const declared = box.declarations.find(({ name }) => name === "agent_status");
    expect(declared?.parameters["properties"]).toStrictEqual({});
    const call = { id: "c1", name: "agent_status", argumentsText: '{"model":"router/big"}' };
    expect(box.prepare(call)).toMatchObject({ ready: false });
    const { text } = await callIn(box);
    expect(text).toContain("Helpers: none shown; this turn is a helper's.");
    expect(chats.set).toStrictEqual([]);
  });

  it("is never handed to a helper from the agent's own parts, which can set a model", () => {
    const parts = partsOf(chatsOf({ chat }).source);
    const names = helperToolBox(parts).declarations.map(({ name }) => name);
    expect(names).not.toContain("agent_status");
    expect(agentToolBox(parts).declarations.map(({ name }) => name)).toContain("agent_status");
  });
});
