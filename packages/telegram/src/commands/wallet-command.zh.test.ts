import { ok } from "@binference/core";
import { protocolIdSchema, type ResultOf, type WalletView } from "@binference/protocol";
import { describe, expect, it } from "vitest";
import { startCommandBot } from "./test-command-bot.js";

const agent = protocolIdSchema("agent").parse("agt_0190f1c2-3a4b-7c5d-8e6f-0000000000a1");
const paper = String.fromCodePoint(0x1f9ea);
const status: ResultOf<"engine/status"> = {
  state: "ready",
  version: "2026.11.0",
  protocol: 1,
  frozen: false,
  agents: [{ id: agent, mode: "paper", frozen: false }],
  health: [],
};

function view(n: number, label: string, marks: Partial<WalletView> = {}): WalletView {
  const wallet = protocolIdSchema("wallet").parse(
    `wal_0190f1c2-3a4b-7c5d-8e6f-0000000000${String(n)}`,
  );
  const address = `fake:1:0x000000${String(n)}` as WalletView["address"];
  return { wallet, agent, address, label, createdAt: n, ...marks };
}

async function walletReply(items: readonly WalletView[]) {
  const bot = await startCommandBot(
    {
      "engine/status": async () => Promise.resolve(ok(status)),
      "wallet/list": async () => Promise.resolve(ok({ items })),
    },
    { locale: "zh" },
  );
  await bot.send("/wallet");
  return bot;
}

describe("the /wallet command in Chinese", () => {
  it("captions each wallet's code with its role, chain, mode and warnings in the owner's language", async () => {
    const bot = await walletReply([
      view(10, "主钱包"),
      view(11, "发射", { role: "launch" }),
      view(12, "跨链", { bridge: true }),
      view(13, "多余", { role: "launch", extra: true }),
    ]);
    const lines = (label: string, role: string, n: number) => [
      `${label} · ${role} · Fake One · ${paper} 模拟`,
      `0x000000${String(n)}`,
      "只向此地址发送 Fake One 上的资产。通过其他网络发送的资产可能会丢失。",
      "这个 Agent 处于模拟模式，只做模拟交易：你转账到这里的是真钱，会留在这个钱包里，直到你把 Agent 切换为实盘。",
      "在 scan.example.invalid 查看",
    ];
    expect(bot.texts()).toStrictEqual([
      lines("主钱包", "Agent 钱包", 10).join("\n"),
      lines("发射", "发射钱包", 11).join("\n"),
      lines("跨链", "跨链钱包", 12).join("\n"),
      [
        `多余 · 额外的发射钱包 · Fake One · ${paper} 模拟`,
        "0x00000013",
        "没有任何功能使用这个钱包。请不要向它转账任何资金。",
        "在 scan.example.invalid 查看",
      ].join("\n"),
    ]);
  });

  it("says in Chinese when the agent has no wallet yet", async () => {
    const bot = await walletReply([]);
    expect(bot.texts()).toStrictEqual(["这个 Agent 还没有钱包。"]);
  });
});
