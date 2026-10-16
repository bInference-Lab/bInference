import { err, ok } from "@binference/core";
import { messages } from "@binference/i18n";
import { describe, expect, it } from "vitest";
import {
  agents,
  bnbPaper,
  cardOf,
  ownerCards,
  pepeOpen,
  pnlHandlers,
} from "../testing/pnl-card-fixtures.js";
import { startCommandBot } from "./test-command-bot.js";

const paper = String.fromCodePoint(0x1f9ea);
const red = String.fromCodePoint(0x1f534);
// The test bot's clock.
const nowMs = 1_760_000_000_000;
const weekMs = 7 * 86_400_000;

const pepeCard = [
  `PEPE (0x6982…1933) · main · ${red} Live`,
  "Holding 2 PEPE (0x6982…1933) · value $6.00",
  "Average cost $2.50 · cost $5.00",
  "P&L unrealized +$1.00 (+20.00%) · realized $0.00",
  "Fees venue $0.08 · network $0.02",
  "Since Oct 8, 2026, 09:30:00",
].join("\n");

describe("the positions command", () => {
  it("shows each position as its P&L card, live under its heading before paper", async () => {
    const handlers = pnlHandlers(ownerCards);
    const bot = await startCommandBot(handlers);
    await bot.send("/positions");
    expect(bot.texts()).toStrictEqual([
      [
        `${red} Live positions`,
        pepeCard,
        [
          `USDT · main · ${red} Live · closed`,
          "Bought for $10.00 · sold for $9.50",
          "P&L realized -$0.50 (-5.00%)",
          "Fees venue $0.08 · network $0.02",
          "Held Oct 8, 2026, 09:30:00 → Oct 9, 2026, 09:30:00 (1 day)",
        ].join("\n"),
        `${paper} Paper positions`,
        [
          `BNB · scout · ${paper} Paper`,
          "Holding 1 BNB",
          "Average cost $600.00 · cost $600.00",
          "P&L unrealized: no price now · realized $0.00",
          "Fees venue $0.00 · network $0.00",
          "Since Oct 8, 2026, 09:30:00",
        ].join("\n"),
      ].join("\n\n"),
    ]);
    const window = { from: nowMs - weekMs, to: nowMs, cards: true };
    expect(handlers.asked()).toStrictEqual([
      { agent: agents.main.agent, ...window },
      { agent: agents.scout.agent, ...window },
    ]);
  });

  it("says paper on a paper position's card, and shows no live heading without live cards", async () => {
    const bot = await startCommandBot(
      pnlHandlers({ [agents.scout.agent]: [cardOf(bnbPaper, agents.scout)] }),
    );
    await bot.send("/positions");
    expect(bot.texts()[0]?.split("\n").slice(0, 3)).toStrictEqual([
      `${paper} Paper positions`,
      "",
      `BNB · scout · ${paper} Paper`,
    ]);
  });

  it("puts as many whole cards in a message as fit, and never splits one", async () => {
    const many = Array.from({ length: 40 }, () => cardOf(pepeOpen, agents.main));
    const bot = await startCommandBot(pnlHandlers({ [agents.main.agent]: many }));
    await bot.send("/positions");
    const sent = bot.texts();
    expect(sent.length).toBeGreaterThan(1);
    expect(sent.every((text) => text.length <= 4096)).toBe(true);
    const cards = sent
      .flatMap((text) => text.split("\n\n"))
      .filter((block) => block !== `${red} Live positions`);
    expect(cards).toStrictEqual(Array.from({ length: 40 }, () => pepeCard));
  });

  it("says when there is no position yet", async () => {
    const bot = await startCommandBot(pnlHandlers({}));
    await bot.send("/positions");
    expect(bot.texts()).toStrictEqual(["No positions yet."]);
  });

  it("answers a refused read with its error and shows no card", async () => {
    const bot = await startCommandBot({
      ...pnlHandlers(ownerCards),
      "portfolio/pnl": async () => Promise.resolve(err("agent.not_found")),
    });
    await bot.send("/positions");
    expect(bot.texts()).toStrictEqual([messages.en["error.agent.not_found"]]);
  });

  it("says there is no position when the owner has no agent", async () => {
    const bot = await startCommandBot({
      ...pnlHandlers(ownerCards),
      "agent/list": async () => Promise.resolve(ok({ items: [] })),
    });
    await bot.send("/positions");
    expect(bot.texts()).toStrictEqual(["No positions yet."]);
  });
});
