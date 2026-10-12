import { ok } from "@binference/core";
import type { OwnerChatHandlers } from "@binference/engine/surfaces";
import { type AgentView, protocolIdSchema, type ResultOf } from "@binference/protocol";
import { describe, expect, it } from "vitest";
import { startCommandBot } from "./test-command-bot.js";

const main = protocolIdSchema("agent").parse("agt_0190f1c2-3a4b-7c5d-8e6f-0000000000a1");
const icons = { paper: String.fromCodePoint(0x1f9ea) };
const agentView: AgentView = {
  agent: main,
  name: "main",
  mode: "paper",
  locale: "zh",
  createdAt: 1,
  changedAt: 1,
};
const status: ResultOf<"engine/status"> = {
  state: "ready",
  version: "2026.10.0",
  protocol: 1,
  frozen: false,
  agents: [{ id: main, mode: "paper", frozen: false }],
  health: [],
};

const handlers: OwnerChatHandlers = {
  "engine/status": async () => Promise.resolve(ok(status)),
  "agent/list": async () => Promise.resolve(ok({ items: [agentView] })),
  "model/list": async () =>
    Promise.resolve(ok({ items: [{ role: "main", model: "router/large", current: true }] })),
  "chat/clear": async () =>
    Promise.resolve(
      ok({
        session: protocolIdSchema("chatSession").parse("ses_0190f1c2-3a4b-7c5d-8e6f-000000000009"),
      }),
    ),
};

describe("the agent and chat commands in Chinese", () => {
  it("list the agents, pick one, and start a new chat in Chinese", async () => {
    const bot = await startCommandBot(handlers, { locale: "zh" });
    await bot.send("/agents");
    await bot.send("/use main");
    await bot.send("/clear");
    await bot.send("/schedules");
    expect(bot.texts()).toStrictEqual([
      `你的 Agent：\nmain · ${icons.paper} 模拟 · 此对话正在使用\n/use 加 Agent 名称可选择此对话使用的 Agent。`,
      "此对话现在使用 main。在你有多个 Agent 时，它的回答会以它的名称开头。",
      "新的对话已开始。Agent 会忘记这段对话，它的笔记和文件仍然保留。",
      "还没有设置定时轮。",
    ]);
  });

  it("show the models in use in Chinese", async () => {
    const bot = await startCommandBot(handlers, { locale: "zh" });
    await bot.send("/ai");
    expect(bot.texts()).toStrictEqual([
      "主模型：router/large\n快速模型：未设置\n点按一个模型，从下一条消息起将它用作主模型。你选择的模型会一直使用，不切换备用模型；点按 config 中的主模型即可恢复备用模型。",
    ]);
  });
});
