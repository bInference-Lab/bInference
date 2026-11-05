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
  it("names each wallet's role, chain and mode in the owner's language", async () => {
    const bot = await walletReply([
      view(10, "主钱包"),
      view(11, "发射", { role: "launch" }),
      view(12, "跨链", { bridge: true }),
      view(13, "多余", { role: "launch", extra: true }),
    ]);
    expect(bot.texts()).toStrictEqual([
      [
        `主钱包 · Agent 钱包 · Fake One · ${paper} 模拟`,
        "0x00000010",
        "在 scan.example.invalid 查看",
        "",
        `发射 · 发射钱包 · Fake One · ${paper} 模拟`,
        "0x00000011",
        "在 scan.example.invalid 查看",
        "",
        `跨链 · 跨链钱包 · Fake One · ${paper} 模拟`,
        "0x00000012",
        "在 scan.example.invalid 查看",
        "",
        `多余 · 额外的发射钱包 · Fake One · ${paper} 模拟`,
        "0x00000013",
        "在 scan.example.invalid 查看",
      ].join("\n"),
    ]);
  });

  it("says in Chinese when the agent has no wallet yet", async () => {
    const bot = await walletReply([]);
    expect(bot.texts()).toStrictEqual(["这个 Agent 还没有钱包。"]);
  });
});
