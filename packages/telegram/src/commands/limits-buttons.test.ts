import { bpsSchema, err, ok } from "@binference/core";
import type { OwnerChatHandlers } from "@binference/engine/surfaces";
import { type LimitsView, protocolIdSchema, type ResultOf } from "@binference/protocol";
import { describe, expect, it } from "vitest";
import { ownerId } from "../testing/update-fixtures.js";
import { startCommandBot } from "./test-command-bot.js";

const agent = protocolIdSchema("agent").parse("agt_0190f1c2-3a4b-7c5d-8e6f-0000000000a1");
const status: ResultOf<"engine/status"> = {
  state: "ready",
  version: "2026.10.0",
  protocol: 1,
  frozen: false,
  agents: [{ id: agent, mode: "live", frozen: false }],
  health: [],
};
const limits = {
  agent,
  changedAt: 1,
  perTradeUsdMicros: 100_000_000n,
  rollingDayUsdMicros: 0n,
  slippageRegistryBps: bpsSchema.parse(50),
  slippageOtherBps: bpsSchema.parse(1),
} as unknown as LimitsView;

/** An engine that keeps one agent's limits and takes every change `limit/set` asks for. */
function limitKeeper(refusal?: "auth.scope") {
  const sets: unknown[] = [];
  let current = limits;
  const handlers: OwnerChatHandlers = {
    "engine/status": async () => Promise.resolve(ok(status)),
    "limit/get": async () => Promise.resolve(ok(current)),
    "limit/set": async ({ args }) => {
      sets.push(args.changes);
      current = { ...current, ...args.changes };
      return Promise.resolve(refusal === undefined ? ok(current) : err(refusal));
    },
  };
  return { handlers, sets };
}

async function shownLimits(refusal?: "auth.scope") {
  const keeper = limitKeeper(refusal);
  const bot = await startCommandBot(keeper.handlers);
  await bot.send("/limits");
  const [message] = bot.botApi.messages();
  const press = async (data: string): Promise<void> =>
    bot.receive(bot.botApi.press({ from: ownerId, data, messageId: message?.messageId ?? 0 }));
  return { bot, keeper, press };
}

describe("the /limits buttons", () => {
  it("show a button for each cap and slippage limit above zero", async () => {
    const { bot } = await shownLimits();
    expect(bot.botApi.messages()[0]?.buttons).toStrictEqual([
      [{ text: "Halve the per-trade cap", data: "bnf1:t:h:perTradeUsdMicros" }],
      [
        {
          text: "Halve the slippage limit on verified tokens",
          data: "bnf1:t:h:slippageRegistryBps",
        },
      ],
      [{ text: "Halve the slippage limit on other tokens", data: "bnf1:t:h:slippageOtherBps" }],
    ]);
  });

  it("halve a limit at a tap, show the limits again, and halve it again at the next", async () => {
    const { bot, keeper, press } = await shownLimits();
    await press("bnf1:t:h:perTradeUsdMicros");
    await press("bnf1:t:h:perTradeUsdMicros");
    expect(keeper.sets).toStrictEqual([
      { perTradeUsdMicros: 50_000_000n },
      { perTradeUsdMicros: 25_000_000n },
    ]);
    expect(bot.botApi.answers().map((answer) => answer.text)).toStrictEqual([
      "Per-trade cap is $50.00 now.",
      "Per-trade cap is $25.00 now.",
    ]);
    const [message] = bot.botApi.messages();
    expect(message?.text.split("\n")[1]).toBe("Per-trade cap: $25.00");
    expect(message?.buttons).toHaveLength(3);
  });

  it("halve a rate down to zero, rounding down, and then take its button away", async () => {
    const { bot, keeper, press } = await shownLimits();
    await press("bnf1:t:h:slippageOtherBps");
    expect(keeper.sets).toStrictEqual([{ slippageOtherBps: 0 }]);
    expect(bot.botApi.messages()[0]?.buttons.map(([button]) => button?.data)).toStrictEqual([
      "bnf1:t:h:perTradeUsdMicros",
      "bnf1:t:h:slippageRegistryBps",
    ]);
  });

  it("say a limit at zero is at its lowest, and set nothing", async () => {
    const { bot, keeper, press } = await shownLimits();
    await press("bnf1:t:h:rollingDayUsdMicros");
    expect(keeper.sets).toStrictEqual([]);
    expect(bot.botApi.answers().map((answer) => answer.text)).toStrictEqual([
      "24-hour cap is $0.00 already, the lowest it goes.",
    ]);
  });

  it("do nothing for data no /limits button carries", async () => {
    const { bot, keeper, press } = await shownLimits();
    await press("bnf1:t:h:venues");
    await press("bnf1:t:x:perTradeUsdMicros");
    expect([keeper.sets, bot.botApi.answers()]).toStrictEqual([[], []]);
  });

  it("say a refusal in the chat and stop the button's spinner", async () => {
    const { bot, press } = await shownLimits("auth.scope");
    await press("bnf1:t:h:perTradeUsdMicros");
    expect(bot.texts().at(-1)).toBe(
      "This client may not do that. Use the console or the CLI on the machine.",
    );
    expect(bot.botApi.answers().map((answer) => answer.text)).toStrictEqual([undefined]);
  });
});
