import { accountRefSchema } from "@binference/chain";
import { BinferenceError, bpsSchema, ok } from "@binference/core";
import type { OwnerChatHandlers, OwnerChatOperation } from "@binference/engine/surfaces";
import {
  type AgentView,
  type LimitsView,
  type OrderView,
  type PortfolioView,
  protocolIdSchema,
  type ResultOf,
} from "@binference/protocol";
import { describe, expect, it } from "vitest";
import { cardIntent, refs } from "../testing/card-fixtures.js";
import { ownerId } from "../testing/update-fixtures.js";
import { fastCommandNames } from "./command-of.js";
import { menuOf } from "./register-commands.js";
import { startCommandBot, waitingSwap } from "./test-command-bot.js";

const live = { signal: new AbortController().signal };
const agent = protocolIdSchema("agent").parse("agt_0190f1c2-3a4b-7c5d-8e6f-0000000000a1");
const second = protocolIdSchema("agent").parse("agt_0190f1c2-3a4b-7c5d-8e6f-0000000000a2");
const wallet = protocolIdSchema("wallet").parse("wal_0190f1c2-3a4b-7c5d-8e6f-0000000000b1");
const order = protocolIdSchema("autoOrder").parse("ord_0190f1c2-3a4b-7c5d-8e6f-0000000000c1");
const rescueAddress = accountRefSchema.parse("fake:1:0x00000000000000000000000000000000000000a1");
const nowMs = Date.UTC(2026, 9, 10, 9, 30, 0);
const coin = 10n ** 18n;
const icons = { paper: String.fromCodePoint(0x1f9ea), live: String.fromCodePoint(0x1f534) };
const warn = `${String.fromCodePoint(0x26a0)}${String.fromCodePoint(0xfe0f)}`;

const status: ResultOf<"engine/status"> = {
  state: "ready",
  version: "2026.10.0",
  protocol: 1,
  frozen: false,
  agents: [{ id: agent, mode: "live", frozen: false }],
  health: [
    { signal: "prices", state: "ok" },
    { signal: "wallets", state: "ok" },
  ],
};
const agentView: AgentView = {
  agent,
  name: "main",
  mode: "paper",
  locale: "en",
  createdAt: nowMs,
  changedAt: nowMs,
};
const limits = {
  agent,
  changedAt: nowMs,
  perTradeUsdMicros: 100_000_000n,
  orderExpiryDays: 30,
  pending: { changes: { perTradeUsdMicros: 500_000_000n }, effectiveAt: nowMs + 86_400_000 },
} as unknown as LimitsView;
const portfolio: PortfolioView = {
  balances: [
    {
      wallet,
      amount: { asset: refs.usdt, base: 50n * coin },
      usdMicros: 50_000_000n,
      paper: false,
    },
    { wallet, amount: { asset: refs.bnb, base: coin / 2n }, usdMicros: 300_000_000n, paper: false },
    { wallet, amount: { asset: refs.bnb, base: coin }, usdMicros: 600_000_000n, paper: true },
  ],
  positions: [
    {
      wallet,
      asset: refs.bnb,
      quantity: coin / 2n,
      costUsdMicros: 250_000_000n,
      realizedUsdMicros: 10_000_000n,
      unrealizedUsdMicros: 50_000_000n,
      paper: false,
    },
    {
      wallet,
      asset: refs.usdt,
      quantity: 0n,
      costUsdMicros: 0n,
      realizedUsdMicros: -2_000_000n,
      paper: false,
    },
  ],
  totalUsdMicros: 350_000_000n,
  paperTotalUsdMicros: 600_000_000n,
  assets: {
    [refs.bnb]: { symbol: "BNB", name: "BNB", decimals: 18, verified: true },
    [refs.usdt]: { symbol: "USDT", name: "Tether USD", decimals: 18, verified: true },
  },
};
const { paperTotalUsdMicros: _paperTotal, ...liveOnly } = portfolio;
const stopLoss: OrderView = {
  order,
  agent,
  wallet,
  kind: "stopLoss",
  state: "active",
  request: {
    agent,
    kind: "stopLoss",
    token: refs.bnb,
    side: "sell",
    size: { percentBps: bpsSchema.parse(10_000) },
    trigger: { price: 550_000_000n },
  },
  fills: 0,
  expiresAt: nowMs,
  createdAt: nowMs,
  changedAt: nowMs,
} as unknown as OrderView;

// The info of the orders' token, which an order page carries.
const orderAssets = { [refs.bnb]: { symbol: "FAKE", name: "Fake", decimals: 18, verified: true } };

// The stop-loss with another kind, side or trigger.
function orderOf(request: Partial<OrderView["request"]>): OrderView {
  return { ...stopLoss, request: { ...stopLoss.request, ...request } } as OrderView;
}

/** Every operation the fast commands run, answered from the fixtures above. */
const served: OwnerChatHandlers = {
  "engine/status": async () => Promise.resolve(ok(status)),
  "safety/status": async () => Promise.resolve(ok({ frozen: false, rescueAddress })),
  "safety/freeze": async () => Promise.resolve(ok({ frozenAt: nowMs })),
  "safety/rescue": async () => Promise.resolve(ok({ intent: cardIntent })),
  "agent/goPaper": async () => Promise.resolve(ok(agentView)),
  "limit/get": async () => Promise.resolve(ok(limits)),
  "portfolio/get": async () => Promise.resolve(ok(portfolio)),
  "order/list": async () => Promise.resolve(ok({ items: [stopLoss], assets: orderAssets })),
  "usage/get": async () =>
    Promise.resolve(
      ok({ rows: [], budgets: [{ agent, dailyUsdMicros: 3_000_000n, leftUsdMicros: 3_000_000n }] }),
    ),
  "wallet/list": async () =>
    Promise.resolve(
      ok({
        items: [{ wallet, agent, address: rescueAddress, label: "main", createdAt: nowMs }],
      }),
    ),
};

// The served handlers but one, as an engine that does not serve that operation yet.
function servedWithout(op: OwnerChatOperation): OwnerChatHandlers {
  const kept = Object.entries(served).filter(([name]) => name !== op);
  return Object.fromEntries(kept);
}

describe("the fast commands", () => {
  it.each(fastCommandNames)("answers /%s without handing it to the agent's model", async (name) => {
    const bot = await startCommandBot(served, { waiting: [waitingSwap] });
    await bot.send(`/${name}`);
    expect(bot.chat).toStrictEqual([]);
    expect(bot.botApi.sent().length).toBeGreaterThan(0);
    expect(bot.botApi.sent().every((sent) => sent.chatId === ownerId)).toBe(true);
  });

  it("hands every other message on to the agent's chat, and runs no edited or forwarded command", async () => {
    const bot = await startCommandBot(served);
    await bot.send("how is my portfolio?");
    await bot.send("/freeze", { isEdit: true });
    await bot.send("/freeze", { isForwarded: true });
    await bot.send("/unknown");
    expect(bot.chat).toHaveLength(4);
    expect(bot.texts()).toStrictEqual([]);
  });

  it("reads a command named for the bot, in any case", async () => {
    const bot = await startCommandBot(served);
    await bot.send("/FREEZE@binference_test_bot now");
    expect(bot.texts()).toHaveLength(1);
    expect(bot.chat).toStrictEqual([]);
  });

  it("lists every command with its menu line under /help", async () => {
    const bot = await startCommandBot(served);
    await bot.send("/help");
    const lines = menuOf("en").map(({ command, description }) => `/${command}: ${description}`);
    expect(bot.texts()).toStrictEqual([
      ["These commands answer at once, without your agent's model:", ...lines].join("\n"),
    ]);
  });

  it("registers the menu for private chats in English and in Chinese", async () => {
    const bot = await startCommandBot(served);
    await bot.commands.register(live);
    expect(bot.botApi.menus()).toStrictEqual([
      { scope: "all_private_chats", commands: menuOf("en") },
      { scope: "all_private_chats", languageCode: "zh", commands: menuOf("zh") },
    ]);
  });

  it("freezes everything and says since when, also when nothing new froze", async () => {
    const bot = await startCommandBot(served);
    await bot.send("/freeze");
    await bot.send("/freeze");
    const done = `${icons.live} Every agent is frozen since Oct 10, 2026, 09:30:00, and every agent made until an unfreeze starts frozen. Their open cards and unsigned actions are cancelled; a transaction already sent finishes. Unfreeze in the CLI, the console or the Mini App.`;
    expect(bot.texts()).toStrictEqual([done, done]);
  });

  it("answers a refusal with its error message, such as an operation the engine does not serve", async () => {
    const bot = await startCommandBot(servedWithout("portfolio/get"));
    await bot.send("/balance");
    expect(bot.texts()).toStrictEqual([
      "This version of binference does not know that request. Update binference or the client.",
    ]);
  });

  it("answers a fault with the internal error's message and logs its code", async () => {
    const failing: OwnerChatHandlers = {
      ...served,
      "safety/freeze": async () => {
        await Promise.resolve();
        throw new BinferenceError({ code: "store.broken", message: "The fixture fails." });
      },
    };
    const bot = await startCommandBot(failing);
    await bot.send("/freeze");
    expect(bot.texts()).toStrictEqual([
      "binference hit an internal error. Run `binference report` to make a support file without secrets.",
    ]);
    expect(bot.logger.records()).toContainEqual(
      expect.objectContaining({
        event: "telegram.command_failed",
        fields: { errorCode: "store.broken" },
      }),
    );
  });

  it("leaves a command for the next pass when Telegram cannot be reached, then answers it once", async () => {
    const bot = await startCommandBot(served);
    bot.botApi.failNext("sendMessage", "network");
    await bot.send("/lang");
    expect(bot.texts()).toStrictEqual([]);
    await bot.send("/help");
    expect(bot.texts()).toHaveLength(2);
    expect(bot.texts()[0]).toContain("binference uses English with you.");
  });
});

describe("the fast commands' replies", () => {
  it("totals live and paper holdings apart, live first, and names the top ones by value", async () => {
    const bot = await startCommandBot(served);
    await bot.send("/balance");
    expect(bot.texts()).toStrictEqual([
      [
        `main · ${icons.live} Live · $350.00`,
        "  0.5 BNB · $300.00",
        "  50 USDT · $50.00",
        `main · ${icons.paper} Paper · $600.00`,
        "  1 BNB · $600.00",
        `${icons.live} Live total: $350.00`,
        `${icons.paper} Paper total: $600.00`,
      ].join("\n"),
    ]);
  });

  it("names five holdings of a wallet and counts the rest", async () => {
    const many = Array.from({ length: 7 }, (_, at) => ({
      wallet,
      amount: { asset: refs.bnb, base: BigInt(at + 1) * coin },
      usdMicros: BigInt(at + 1) * 1_000_000n,
      paper: false,
    }));
    const bot = await startCommandBot({
      ...served,
      "portfolio/get": async () => Promise.resolve(ok({ ...portfolio, balances: many })),
    });
    await bot.send("/balance");
    const [text] = bot.texts();
    expect(text?.split("\n").slice(1, 7)).toStrictEqual([
      "  7 BNB · $7.00",
      "  6 BNB · $6.00",
      "  5 BNB · $5.00",
      "  4 BNB · $4.00",
      "  3 BNB · $3.00",
      "  and 2 more holdings; /positions lists every one",
    ]);
  });

  it("lists each position with its value, average cost and P&L, and a closed one's P&L", async () => {
    const bot = await startCommandBot(served);
    await bot.send("/positions");
    expect(bot.texts()).toStrictEqual([
      [
        `main · ${icons.live} Live`,
        "  0.5 BNB · value $300.00 · average cost $500.00 · P&L $60.00",
        "  USDT · closed · realized P&L -$2.00",
      ].join("\n"),
    ]);
  });

  it("names a token without its info by its short address, in base units", async () => {
    const unknown = {
      wallet,
      asset: refs.pepe,
      quantity: 1_000n,
      costUsdMicros: 5_000_000n,
      realizedUsdMicros: 0n,
      paper: false,
    };
    const balance = { wallet, amount: { asset: refs.pepe, base: 1_000n }, paper: false };
    const bot = await startCommandBot({
      ...served,
      "portfolio/get": async () =>
        Promise.resolve(
          ok({ ...liveOnly, balances: [balance], positions: [unknown], totalUsdMicros: 0n }),
        ),
    });
    await bot.send("/positions");
    await bot.send("/balance");
    expect(bot.texts()).toStrictEqual([
      `main · ${icons.live} Live\n  1000 base units of 0x6982…1933 · paid $5.00 in all · realized P&L $0.00`,
      [
        `main · ${icons.live} Live · $0.00`,
        "  1000 base units of 0x6982…1933 · no price now",
        `${icons.live} Live total: $0.00`,
      ].join("\n"),
    ]);
  });

  it("splits a reply longer than one Telegram message at line breaks", async () => {
    const positions = Array.from({ length: 120 }, () => portfolio.positions[0]).filter(
      (position) => position !== undefined,
    );
    const bot = await startCommandBot({
      ...served,
      "portfolio/get": async () => Promise.resolve(ok({ ...portfolio, positions })),
    });
    await bot.send("/positions");
    const sent = bot.texts();
    expect(sent.length).toBeGreaterThan(1);
    expect(sent.every((text) => text.length <= 4096)).toBe(true);
    expect(sent.join("\n").split("\n")).toHaveLength(121);
  });

  it("lists the active auto orders with their triggers and fills", async () => {
    const bot = await startCommandBot(served);
    await bot.send("/orders");
    const empty = await startCommandBot({
      ...served,
      "order/list": async () => Promise.resolve(ok({ items: [], assets: {} })),
    });
    await empty.send("/orders");
    expect(empty.texts()).toStrictEqual(["No active auto orders."]);
    expect(bot.texts()).toStrictEqual([
      "Stop-loss · sell FAKE · at $550.00 · 0 fills · ends Oct 10, 2026, 09:30:00",
    ]);
  });

  it("writes the trigger of every kind of auto order", async () => {
    const leader = "fake:1:0x00000000000000000000000000000000000000d1";
    const orders = [
      orderOf({ kind: "limit", side: "buy", trigger: { price: 500_000_000n, direction: "below" } }),
      orderOf({ kind: "trailing", trigger: { distanceBps: bpsSchema.parse(500) } }),
      orderOf({ kind: "dca", side: "buy", trigger: { cron: "0 9 * * 1" } }),
      orderOf({
        kind: "copy",
        side: "buy",
        trigger: { leader, perBuyUsdMicros: 1n, dailyUsdMicros: 1n },
      } as Partial<OrderView["request"]>),
    ];
    const bot = await startCommandBot({
      ...served,
      "order/list": async () => Promise.resolve(ok({ items: orders, assets: orderAssets })),
    });
    await bot.send("/orders");
    const ends = "0 fills · ends Oct 10, 2026, 09:30:00";
    expect(bot.texts()[0]?.split("\n")).toStrictEqual([
      `Limit order · buy FAKE · at or below $500.00 · ${ends}`,
      `Trailing stop · sell FAKE · 5.00% from the best price · ${ends}`,
      `DCA · buy FAKE · on the schedule 0 9 * * 1 · ${ends}`,
      `Copy trade · buy FAKE · copying 0x0000…00d1 · ${ends}`,
    ]);
  });

  it("shows the engine's state, a lock, the freezes, the rescue address and the health", async () => {
    const bot = await startCommandBot({
      ...served,
      "engine/status": async () =>
        Promise.resolve(
          ok({
            ...status,
            state: "locked",
            agents: [{ id: agent, mode: "live", frozen: true }],
            health: [
              { signal: "prices", state: "fail" },
              { signal: "wallets", state: "warn" },
            ],
          }),
        ),
      "safety/status": async () =>
        Promise.resolve(
          ok({
            frozen: true,
            frozenAt: nowMs,
            agents: [{ agent, frozenAt: nowMs }],
            rescue: { intent: cardIntent, state: "executing" },
            rescueAddress,
          }),
        ),
    });
    await bot.send("/status");
    expect(bot.texts()).toStrictEqual([
      [
        "binference 2026.10.0 is running but locked.",
        `${icons.live} Locked: binference signs nothing until you run \`binference unlock\` on the machine.`,
        `${icons.live} Every agent is frozen since Oct 10, 2026, 09:30:00, and every agent made until an unfreeze starts frozen.`,
        "A rescue is under way: sending.",
        "Rescue address: 0x00000000000000000000000000000000000000a1",
        `${agent} · ${icons.live} Live · frozen since Oct 10, 2026, 09:30:00`,
        `${warn} Health: 1 signal failing, 1 needs a look. Run \`binference health\` on the machine.`,
      ].join("\n"),
    ]);
  });

  it("says when no rescue address is set, and when every health signal is fine", async () => {
    const bot = await startCommandBot({
      ...served,
      "safety/status": async () => Promise.resolve(ok({ frozen: false })),
    });
    await bot.send("/status");
    expect(bot.texts()).toStrictEqual([
      [
        "binference 2026.10.0 is running.",
        `${warn} No rescue address is set. Run \`binference rescue set\` on the machine with your own wallet's address.`,
        `${agent} · ${icons.live} Live`,
        "Health: all 2 signals are fine.",
      ].join("\n"),
    ]);
  });

  it("switches the only agent to paper mode, and says when it was there already", async () => {
    const bot = await startCommandBot(served);
    await bot.send("/paper");
    const paper = await startCommandBot({
      ...served,
      "engine/status": async () =>
        Promise.resolve(ok({ ...status, agents: [{ id: agent, mode: "paper", frozen: false }] })),
    });
    await paper.send("/paper");
    expect([...bot.texts(), ...paper.texts()]).toStrictEqual([
      `${icons.paper} main is in paper mode now: its trades fill on paper and nothing is sent on chain. Going live needs \`binference live\` on the machine.`,
      `${icons.paper} main is in paper mode already.`,
    ]);
  });

  it("names no agent with none or several, and points to the CLI", async () => {
    const none = await startCommandBot({
      ...served,
      "engine/status": async () => Promise.resolve(ok({ ...status, agents: [] })),
    });
    await none.send("/limits");
    const several = await startCommandBot({
      ...served,
      "engine/status": async () =>
        Promise.resolve(
          ok({
            ...status,
            agents: [
              { id: agent, mode: "live", frozen: false },
              { id: second, mode: "paper", frozen: false },
            ],
          }),
        ),
    });
    await several.send("/paper");
    expect([...none.texts(), ...several.texts()]).toStrictEqual([
      "binference has no agent yet. Run `binference init` on the machine to make one.",
      `binference has 2 agents: ${agent}, ${second}. Run this in the CLI and name one with \`--agent\`.`,
    ]);
  });

  it("lists the agent's limits in effect, the looser ones that wait, and a button to halve each cap", async () => {
    const bot = await startCommandBot(served);
    await bot.send("/limits");
    expect(bot.texts()).toStrictEqual([
      [
        `Limits of ${agent} in effect now:`,
        "Per-trade cap: $100.00",
        "How long an auto order lasts: 30 days",
        "These looser limits apply at Oct 11, 2026, 09:30:00. Not you? Run `binference limit cancel` on the machine.",
        "Per-trade cap: $500.00",
        "Each button halves its limit at once; a second tap halves it again. Nothing here loosens a limit.",
      ].join("\n"),
    ]);
    expect(bot.botApi.messages()[0]?.buttons).toStrictEqual([
      [{ text: "Halve the per-trade cap", data: "bnf1:t:h:perTradeUsdMicros" }],
    ]);
  });

  it("says the language binference uses, with a button for each language named in itself", async () => {
    const bot = await startCommandBot(served);
    await bot.send("/lang");
    expect(bot.texts()).toStrictEqual([
      "binference uses English with you. Tap a language to switch; binference applies it at once.",
    ]);
    expect(bot.botApi.messages()[0]?.buttons).toStrictEqual([
      [
        { text: "English", data: "bnf1:l:s:en" },
        { text: String.fromCodePoint(0x4e2d, 0x6587), data: "bnf1:l:s:zh" },
      ],
    ]);
  });
});
