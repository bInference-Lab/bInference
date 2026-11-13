import { ok } from "@binference/core";
import type { OwnerChatHandlers } from "@binference/engine/surfaces";
import { protocolIdSchema, type ResultOf, type WalletView } from "@binference/protocol";
import { qrPng } from "@binference/qr";
import { describe, expect, it } from "vitest";
import { startCommandBot } from "./test-command-bot.js";

const agent = protocolIdSchema("agent").parse("agt_0190f1c2-3a4b-7c5d-8e6f-0000000000a1");
const walletId = (n: number) =>
  protocolIdSchema("wallet").parse(`wal_0190f1c2-3a4b-7c5d-8e6f-0000000000${String(n)}`);
const paper = String.fromCodePoint(0x1f9ea);
const network = "Send only Fake One assets here. Assets sent on any other network can be lost.";

function statusOf(agentStatus: {
  mode: "live" | "paper";
  frozen: boolean;
}): ResultOf<"engine/status"> {
  return {
    state: "ready",
    version: "2026.11.0",
    protocol: 1,
    frozen: false,
    agents: [{ id: agent, ...agentStatus }],
    health: [],
  };
}

// A wallet on the fake chain as `wallet/list` answers it: with its chain's name and its page on
// the chain's first explorer.
function view(n: number, label: string, marks: Partial<WalletView> = {}): WalletView {
  const address = `fake:1:0x000000${String(n)}` as WalletView["address"];
  const explorerLink = `https://scan.example.invalid/address/0x000000${String(n)}`;
  const chain = { chainName: "Fake One", explorerLink };
  return { wallet: walletId(n), agent, address, label, createdAt: n, ...chain, ...marks };
}

function walletsBot(
  items: readonly WalletView[],
  agentStatus: { mode: "live" | "paper"; frozen: boolean } = { mode: "live", frozen: false },
) {
  const asked: unknown[] = [];
  const handlers: OwnerChatHandlers = {
    "engine/status": async () => Promise.resolve(ok(statusOf(agentStatus))),
    "wallet/list": async ({ args }) => {
      asked.push(args);
      return Promise.resolve(ok({ items }));
    },
  };
  return { handlers, asked };
}

describe("the /wallet command", () => {
  it("sends each wallet as the QR code of its own address, captioned with its name, address and warnings", async () => {
    const engine = walletsBot([
      view(10, "Main"),
      view(11, "Launch", { role: "launch" }),
      view(12, "Old", { archivedAt: 20 }),
    ]);
    const bot = await startCommandBot(engine.handlers);
    await bot.send("/wallet");

    expect(engine.asked).toStrictEqual([{ agent }]);
    const messages = bot.botApi.messages();
    expect(messages.map((message) => message.file?.bytes)).toStrictEqual([
      qrPng("0x00000010"),
      qrPng("0x00000011"),
    ]);
    expect(messages[0]).toMatchObject({
      text: [
        "Main · agent wallet",
        "0x00000010",
        "",
        network,
        "",
        "View on scan.example.invalid",
      ].join("\n"),
      entities: [
        { type: "bold", offset: 0, length: 4 },
        { type: "code", offset: 20, length: 10 },
        { type: "blockquote" },
        { type: "text_link", url: "https://scan.example.invalid/address/0x00000010" },
      ],
    });
    expect(messages[1]?.text.split("\n")[0]).toBe("Launch · launch wallet");
  });

  it("warns that a paper agent's deposit is real money and a frozen agent trades nothing", async () => {
    const bot = await startCommandBot(
      walletsBot([view(10, "Main")], { mode: "paper", frozen: true }).handlers,
    );
    await bot.send("/wallet");
    expect(bot.botApi.messages()[0]?.text.split("\n")).toStrictEqual([
      "Main · agent wallet",
      "0x00000010",
      "",
      network,
      `${paper} Paper mode: deposits are real money and stay in this wallet until you switch the agent to live.`,
      "Frozen: deposits arrive, but the agent trades nothing until you unfreeze it.",
      "",
      "View on scan.example.invalid",
    ]);
  });

  it("names the breaker's hold in the place of a freeze, and no unfreeze", async () => {
    const { handlers } = walletsBot([view(10, "Main")], { mode: "live", frozen: true });
    const held = { frozen: true, breaker: { pulledAt: 1 } } as const;
    const bot = await startCommandBot({
      ...handlers,
      "safety/status": async () => Promise.resolve(ok(held)),
    });
    await bot.send("/wallet");
    expect(bot.botApi.messages()[0]?.text.split("\n")).toContain(
      "Held by bInference's breaker: deposits arrive and stay in this wallet, but the agent trades nothing until bInference lifts it.",
    );
  });

  it("gives a wallet nothing runs from no QR code, and says to send it nothing", async () => {
    const bot = await startCommandBot(
      walletsBot([view(13, "Spare", { bridge: true, extra: true })]).handlers,
    );
    await bot.send("/wallet");
    const [message] = bot.botApi.messages();
    expect(message?.file).toBeUndefined();
    expect(message?.text.split("\n")).toStrictEqual([
      "Spare · extra bridge wallet",
      "0x00000013",
      "",
      "Nothing runs from this wallet. Send it no funds.",
      "",
      "View on scan.example.invalid",
    ]);
  });

  it("names the chain as the engine does, with no explorer link when the engine names none", async () => {
    const address = "fake:2:0x00000014" as WalletView["address"];
    const { explorerLink: _none, ...far } = view(14, "Far");
    const other = { ...far, address, chainName: "Fake Two" };
    const bot = await startCommandBot(walletsBot([other]).handlers);
    await bot.send("/wallet");
    expect(bot.botApi.messages()).toMatchObject([
      {
        text: [
          "Far · agent wallet",
          "0x00000014",
          "",
          "Send only Fake Two assets here. Assets sent on any other network can be lost.",
        ].join("\n"),
        file: { bytes: qrPng("0x00000014") },
      },
    ]);
  });

  it("sends the lines as a message when Telegram refuses the photo", async () => {
    const bot = await startCommandBot(walletsBot([view(10, "Main")]).handlers);
    bot.botApi.failNext("sendPhoto", {
      status: 400,
      description: "Bad Request: IMAGE_PROCESS_FAILED",
    });
    await bot.send("/wallet");
    const [message] = bot.botApi.messages();
    expect(message?.file).toBeUndefined();
    expect(message?.text.split("\n").slice(0, 2)).toStrictEqual([
      "Main · agent wallet",
      "0x00000010",
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
    expect(message?.text.split("\n")[0]).toBe("<b>Main</b> & co · agent wallet");
    expect(message?.entities.map((entity) => entity.type)).toStrictEqual([
      "bold",
      "code",
      "blockquote",
      "text_link",
    ]);
  });
});
