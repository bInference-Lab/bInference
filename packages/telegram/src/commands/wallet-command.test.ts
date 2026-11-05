import { ok } from "@binference/core";
import type { OwnerChatHandlers } from "@binference/engine/surfaces";
import { protocolIdSchema, type ResultOf, type WalletView } from "@binference/protocol";
import { describe, expect, it } from "vitest";
import { startCommandBot } from "./test-command-bot.js";

const agent = protocolIdSchema("agent").parse("agt_0190f1c2-3a4b-7c5d-8e6f-0000000000a1");
const walletId = (n: number) =>
  protocolIdSchema("wallet").parse(`wal_0190f1c2-3a4b-7c5d-8e6f-0000000000${String(n)}`);
const live = String.fromCodePoint(0x1f534);
const status: ResultOf<"engine/status"> = {
  state: "ready",
  version: "2026.11.0",
  protocol: 1,
  frozen: false,
  agents: [{ id: agent, mode: "live", frozen: false }],
  health: [],
};

function view(n: number, label: string, marks: Partial<WalletView> = {}): WalletView {
  const address = `fake:1:0x000000${String(n)}` as WalletView["address"];
  return { wallet: walletId(n), agent, address, label, createdAt: n, ...marks };
}

function walletsBot(items: readonly WalletView[]) {
  const asked: unknown[] = [];
  const handlers: OwnerChatHandlers = {
    "engine/status": async () => Promise.resolve(ok(status)),
    "wallet/list": async ({ args }) => {
      asked.push(args);
      return Promise.resolve(ok({ items }));
    },
  };
  return { handlers, asked };
}

describe("the /wallet command", () => {
  it("shows each wallet's role, chain and mode, its address as code and its explorer page", async () => {
    const engine = walletsBot([
      view(10, "Main"),
      view(11, "Launch", { role: "launch" }),
      view(12, "Old", { archivedAt: 20 }),
    ]);
    const bot = await startCommandBot(engine.handlers);
    await bot.send("/wallet");

    expect(engine.asked).toStrictEqual([{ agent }]);
    expect(bot.botApi.messages()).toMatchObject([
      {
        text: [
          `Main · agent wallet · Fake One · ${live} Live`,
          "0x00000010",
          "View on scan.example.invalid",
          "",
          `Launch · launch wallet · Fake One · ${live} Live`,
          "0x00000011",
          "View on scan.example.invalid",
        ].join("\n"),
        entities: [
          { type: "code", offset: 41, length: 10 },
          {
            type: "text_link",
            offset: 52,
            length: 28,
            url: "https://scan.example.invalid/address/0x00000010",
          },
          { type: "code", offset: 126, length: 10 },
          {
            type: "text_link",
            offset: 137,
            length: 28,
            url: "https://scan.example.invalid/address/0x00000011",
          },
        ],
      },
    ]);
  });

  it("names an extra bridge wallet a rebuild adopted, so the owner rescues what it holds", async () => {
    const bot = await startCommandBot(
      walletsBot([view(13, "Spare", { bridge: true, extra: true })]).handlers,
    );
    await bot.send("/wallet");
    expect(bot.texts()[0]?.split("\n")[0]).toBe(
      `Spare · extra bridge wallet · Fake One · ${live} Live`,
    );
  });

  it("names a chain the registry does not list as the engine does, with no explorer link", async () => {
    const address = "fake:2:0x00000014" as WalletView["address"];
    const other = { ...view(14, "Far"), address, chainName: "Fake Two" };
    const bot = await startCommandBot(walletsBot([other]).handlers);
    await bot.send("/wallet");
    expect(bot.botApi.messages()).toMatchObject([
      {
        text: `Far · agent wallet · Fake Two · ${live} Live\n0x00000014`,
        entities: [{ type: "code" }],
      },
    ]);
  });

  it("says when the agent has no wallet yet", async () => {
    const bot = await startCommandBot(walletsBot([view(12, "Old", { archivedAt: 20 })]).handlers);
    await bot.send("/wallet");
    expect(bot.texts()).toStrictEqual(["This agent has no wallet yet."]);
  });

  it("shows a wallet label as the owner wrote it, its markup as text", async () => {
    const bot = await startCommandBot(walletsBot([view(10, "<b>Main</b> & co")]).handlers);
    await bot.send("/wallet");
    const [message] = bot.botApi.messages();
    expect(message?.text.split("\n")[0]).toBe(
      `<b>Main</b> & co · agent wallet · Fake One · ${live} Live`,
    );
    expect(message?.entities.map((entity) => entity.type)).toStrictEqual(["code", "text_link"]);
  });
});
