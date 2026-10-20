import type { JsonValue } from "@binference/core";
import { describe, expect, it } from "vitest";
import { toolBoxContract } from "../contracts/tool-box-contract.js";
import { createTestTurn } from "../loop/test-turns.js";
import {
  agent,
  alertWire,
  candle,
  callTool,
  callToolWith,
  coin,
  coinInfo,
  context,
  intent,
  intentWire,
  leader,
  order,
  orderWire,
  priceCondition,
  schedule,
  scheduleWire,
  stopLoss,
  swapTerms,
  token,
  toolTurn,
  trade,
  wallet,
} from "../testing/agent-tool-fixtures.js";
import { createFakeToolClient, type FakeAnswer } from "../testing/fake-tool-client.js";
import { callsReply, textReply } from "../testing/scripted-transport.js";
import { agentToolBox, agentTools } from "./agent-tools.js";

const launchTerms = {
  reason: "You asked for a cat token",
  venue: "fake-curve",
  name: "Moon Cat",
  symbol: "MCAT",
  pairWith: coin,
};

const answers: Readonly<Record<string, FakeAnswer>> = {
  "asset/search": { items: [{ asset: coin, ...coinInfo }] },
  "portfolio/get": { balances: [], positions: [], totalUsdMicros: "0", assets: {} },
  "asset/get": { asset: coin, ...coinInfo },
  "risk/check": { verdict: "pass", flags: [], onCurve: false, checkedAt: 1 },
  "quote/get": {
    route: [{ venue: "fake-swap", shareBps: 10_000 }],
    amountIn: { asset: coin, base: "1000" },
    expectedOut: { asset: token, base: "2000" },
    minOut: { asset: token, base: "1990" },
    priceImpactBps: 12,
    gas: { asset: coin, base: "21000" },
    quotedAt: 1,
    expiresAt: 2,
  },
  "order/list": { items: [] },
  "intent/get": intentWire("awaiting_confirmation"),
  "market/scan": {
    items: [{ asset: token, launchpad: "fake-curve", graduated: false }],
    assets: {},
  },
  "market/chart": {
    asset: token,
    interval: "1h",
    candles: [candle],
    source: "geckoterminal",
  },
  "wallet/activity": { items: [trade], assets: {} },
  "intent/propose": intentWire("awaiting_confirmation"),
  "order/create": orderWire("awaiting_confirmation"),
  "order/get": orderWire("active"),
  "order/cancel": orderWire("cancelled"),
  "notes/search": { items: [] },
  "alert/create": alertWire(),
  "schedule/list": { items: [scheduleWire()] },
  "schedule/create": scheduleWire(),
  "schedule/cancel": {},
  "agent/editFile": { updatedAt: 1 },
  "agent/endFirstChat": {},
  "launchpad/list": { items: [] },
  "launch/draft": { draft: "c2hvd24tb25jZS1h", expiresAt: 600_001 },
  "turn/ask": {
    question: "qst_0190f1c2-3a4b-7c5d-8e6f-0123456789ab",
    agent,
    session: toolTurn.session,
    turn: toolTurn.turn,
    text: "Hold for hours or days?",
    choices: ["Hours", "Days"],
    state: "open",
    createdAt: 1,
    closesAt: 86_400_001,
  },
  "skill/read": {
    skill: "safe-swap",
    place: "bundled",
    location: "bundled/safe-swap/SKILL.md",
    file: "SKILL.md",
    text: "# Safe swap",
  },
  "notes/write": {
    note: "1",
    agent,
    text: "Likes stablecoins",
    origin: "agent",
    createdAt: 1,
    changedAt: 1,
  },
};

const key = context.idempotencyKey;
const scanFilters = { launchpads: ["fake-curve"], maxTaxBps: 500 };
const buyTerms = { token, spend: { asset: coin, base: "1000" }, reason: "Buy the dip." };
const sellTerms = { token, amount: { percentBps: 5_000 }, reason: "Take half off." };

// Each tool, the arguments a model writes, and the calls it makes of the engine.
const mappings: readonly (readonly [string, JsonValue, JsonValue])[] = [
  [
    "token_search",
    { chain: "fake:1", query: "FAKE" },
    [{ op: "asset/search", args: { chain: "fake:1", query: "FAKE", agent } }],
  ],
  ["portfolio", {}, [{ op: "portfolio/get", args: { agent } }]],
  ["token_info", { asset: coin }, [{ op: "asset/get", args: { asset: coin } }]],
  ["token_risk", { asset: token }, [{ op: "risk/check", args: { asset: token } }]],
  ["quote", swapTerms, [{ op: "quote/get", args: { ...swapTerms, agent, kind: "swap" } }]],
  [
    "orders",
    { state: "active", cursor: "c1" },
    [{ op: "order/list", args: { state: "active", cursor: "c1", agent } }],
  ],
  ["tx_status", { intent }, [{ op: "intent/get", args: { intent } }]],
  [
    "market_scan",
    { chain: "fake:1", source: "launches", filters: scanFilters },
    [
      {
        op: "market/scan",
        args: { chain: "fake:1", source: "launches", filters: scanFilters, limit: 10 },
      },
    ],
  ],
  [
    "chart",
    { asset: token, interval: "1h", to: "2026-10-20T09:00:00+08:00" },
    [
      {
        op: "market/chart",
        args: { asset: token, interval: "1h", to: 1_792_458_000_000, limit: 60 },
      },
    ],
  ],
  [
    "wallet_activity",
    { account: leader, from: "2026-10-20T09:00:00+08:00", cursor: "c1", limit: 5 },
    [
      {
        op: "wallet/activity",
        args: { account: leader, from: 1_792_458_000_000, cursor: "c1", limit: 5, agent },
      },
    ],
  ],
  ["schedule_list", {}, [{ op: "schedule/list", args: { agent } }]],
  [
    "notes_search",
    { query: "stable" },
    [{ op: "notes/search", args: { agent, query: "stable", limit: 10 } }],
  ],
  [
    "open_skill",
    { skill: "safe-swap" },
    [{ op: "skill/read", args: { agent, skill: "safe-swap" } }],
  ],
  ["swap", swapTerms, [{ op: "intent/propose", args: { ...swapTerms, agent, kind: "swap" }, key }]],
  ["buy", buyTerms, [{ op: "intent/propose", args: { ...buyTerms, agent, kind: "buy" }, key }]],
  ["sell", sellTerms, [{ op: "intent/propose", args: { ...sellTerms, agent, kind: "sell" }, key }]],
  [
    "order_create",
    { order: stopLoss },
    [{ op: "order/create", args: { ...stopLoss, agent }, key }],
  ],
  [
    "order_cancel",
    { order },
    [
      { op: "order/get", args: { order } },
      { op: "order/cancel", args: { order }, key },
    ],
  ],
  [
    "alert_create",
    { condition: priceCondition, wake: true, expiresAt: "2026-10-20T09:00:00+08:00" },
    [
      {
        op: "alert/create",
        args: { condition: priceCondition, wake: true, expiresAt: 1_792_458_000_000, agent },
        key,
      },
    ],
  ],
  [
    "schedule_create",
    { when: { cron: "0 9 * * 1" }, prompt: "Report the portfolio." },
    [
      {
        op: "schedule/create",
        args: { when: { cron: "0 9 * * 1" }, prompt: "Report the portfolio.", agent },
        key,
      },
    ],
  ],
  [
    "schedule_cancel",
    { schedule },
    [
      { op: "schedule/list", args: { agent } },
      { op: "schedule/cancel", args: { schedule }, key },
    ],
  ],
  [
    "notes_write",
    { text: "Likes stablecoins" },
    [{ op: "notes/write", args: { agent, text: "Likes stablecoins" }, key }],
  ],
  [
    "workspace_write",
    { file: "STRATEGY.md", text: "Hold for days." },
    [{ op: "agent/editFile", args: { agent, file: "STRATEGY.md", text: "Hold for days." }, key }],
  ],
  ["first_chat_end", {}, [{ op: "agent/endFirstChat", args: { agent }, key }]],
  ["launchpads", { chain: "fake:1" }, [{ op: "launchpad/list", args: { chain: "fake:1" } }]],
  [
    "launch_draft",
    { launch: launchTerms },
    [
      {
        op: "launch/draft",
        args: {
          agent,
          session: toolTurn.session,
          turn: toolTurn.turn,
          launch: launchTerms,
        },
        key,
      },
    ],
  ],
  [
    "ask_owner",
    { text: "Hold for hours or days?", choices: ["Hours", "Days"] },
    [
      {
        op: "turn/ask",
        args: {
          agent,
          session: toolTurn.session,
          turn: toolTurn.turn,
          text: "Hold for hours or days?",
          choices: ["Hours", "Days"],
        },
        key,
      },
    ],
  ],
];

const names = mappings.map(([name]) => name);

// The control tools that write, each with the arguments its row above gives.
const controlWrites = new Set([
  "order_cancel",
  "alert_create",
  "schedule_create",
  "schedule_cancel",
  "notes_write",
  "workspace_write",
  "first_chat_end",
  "launch_draft",
]);
const controls = mappings.filter(([name]) => controlWrites.has(name));

describe("the agent's tools", () => {
  it.each(
    toolBoxContract({
      create: async () => ({
        box: agentToolBox({ agent, client: createFakeToolClient({}), turn: toolTurn }),
        call: { id: "c1", name: "token_risk", argumentsText: JSON.stringify({ asset: token }) },
      }),
    }),
  )("follow the tool box contract: $name", async ({ run }) => {
    await expect(run()).resolves.toBeUndefined();
  });

  it("are the reads, the proposals, the brake, the control writes, the workspace writes and the question", () => {
    const tools = agentTools({ agent, client: createFakeToolClient({}), turn: toolTurn });
    expect(tools.map((tool) => tool.name)).toStrictEqual(names);
  });

  it.each(mappings)("map %s onto its operation for the turn's agent", async (name, args, calls) => {
    const run = callTool(answers, { name, args });
    await expect(run.outcome).resolves.toMatchObject({ isError: false });
    expect(run.client.calls()).toStrictEqual(calls);
  });

  it.each(names)("show the model no agent or wallet field in %s", (name) => {
    const box = agentToolBox({ agent, client: createFakeToolClient({}), turn: toolTurn });
    const declaration = box.declarations.find((tool) => tool.name === name);
    expect(JSON.stringify(declaration?.parameters)).not.toMatch(/"(agent|wallet)":/);
  });

  it.each([
    ["swap", { ...swapTerms, wallet }],
    ["swap", { ...swapTerms, agent: "agt_0190f1c2-3a4b-7c5d-8e6f-0000000000ff" }],
    ["buy", { ...buyTerms, wallet }],
    ["sell", { ...sellTerms, wallet }],
    ["order_create", { order: { ...stopLoss, wallet } }],
    ["portfolio", { wallet }],
    ["token_search", { chain: "fake:1", query: "FAKE", agent }],
  ] as const)("refuse a %s call naming a wallet or an agent before the engine", (name, args) => {
    const run = callTool(answers, { name, args });
    expect(run.refused).toMatch(/^not run: the arguments do not match/);
    expect(run.client.calls()).toStrictEqual([]);
  });

  it("refuse an amount written as a number", () => {
    const run = callTool(answers, { name: "swap", args: { ...swapTerms, amount: { base: 1500 } } });
    expect(run.refused).toMatch(/^not run/);
  });

  it("keep an amount past 2^53 exact on its way to the engine", async () => {
    const text = JSON.stringify(swapTerms).replace(
      '"123456789012345678901"',
      "123456789012345678901",
    );
    const run = callToolWith(answers, "swap", text);
    await expect(run.outcome).resolves.toMatchObject({ isError: false });
    expect(run.client.calls()).toMatchObject([
      { args: { amount: { base: "123456789012345678901" } } },
    ]);
  });

  it.each(controls)("let the turn go on after %s, which never commits it", async (name, args) => {
    const { turn } = createTestTurn({
      box: agentToolBox({ agent, client: createFakeToolClient(answers), turn: toolTurn }),
      replies: [callsReply([{ id: "a", name, args }]), textReply("Done.")],
    });
    await expect(turn.run()).resolves.toMatchObject({
      state: "ended",
      outcome: "ok",
      committed: false,
      modelCalls: 2,
    });
  });

  it("run order_cancel in the batch of the turn's proposal, after it commits", async () => {
    const client = createFakeToolClient(answers);
    const { turn, recorder } = createTestTurn({
      box: agentToolBox({ agent, client, turn: toolTurn }),
      replies: [
        callsReply([
          { id: "a", name: "swap", args: swapTerms },
          { id: "b", name: "order_cancel", args: { order } },
        ]),
        textReply("never asked"),
      ],
    });
    await expect(turn.run()).resolves.toMatchObject({ committed: true });
    expect(client.calls().map(({ op }) => op)).toStrictEqual([
      "intent/propose",
      "order/get",
      "order/cancel",
    ]);
    const results = recorder.steps.filter((step) => step.kind === "result");
    expect(results.map((step) => [step.id, step.text])).toStrictEqual([
      ["a", `Intent ${intent} is waiting for the owner's confirmation in Telegram or the console.`],
      ["b", `Auto order ${order} is cancelled.`],
    ]);
  });
});
