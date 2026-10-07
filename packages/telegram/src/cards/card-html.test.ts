import { bpsSchema } from "@binference/core";
import { type CardAction, type CardFacts, type CardValue, drawCard } from "@binference/engine";
import { createFormatter, displayOutsideText } from "@binference/i18n";
import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  accountRef,
  assetsWith,
  cardExpiresAtMs,
  pepeBuyFacts,
  refs,
  swapFacts,
} from "../testing/card-fixtures.js";
import { parseFakeHtml } from "../testing/fake-html.js";
import { type CardDisplay, cardHtml, receiptHtml } from "./card-html.js";

type ChainRef = Extract<CardValue, { readonly type: "chain" }>["chain"];

// The status icons of spec 4, from their code points: code and tests carry no emojis.
const icons = {
  waiting: String.fromCodePoint(0x1f7e1),
  done: String.fromCodePoint(0x2705),
  refused: String.fromCodePoint(0x274c),
  live: String.fromCodePoint(0x1f534),
  paper: String.fromCodePoint(0x1f9ea),
};
const english = createFormatter({ locale: "en", timeZone: "UTC" });
const display: CardDisplay = { formatter: english, assets: assetsWith() };
const recipient = accountRef("fake:1:0xAbCdEf0123456789aBcDeF0123456789AbCdEf12");
const oneUsdt = { asset: refs.usdt, base: 10n ** 18n };

// What a reader sees: Telegram's parse of the HTML, which must parse.
function shown(html: string) {
  const parsed = parseFakeHtml(html);
  expect(parsed.ok).toBe(true);
  return parsed.ok ? parsed.value : { text: "", entities: [] };
}

function linesOf(facts: CardFacts, cardDisplay: CardDisplay = display): readonly string[] {
  return shown(cardHtml(drawCard(facts), cardDisplay)).text.split("\n");
}

function actionLineOf(action: CardAction): string {
  return linesOf({ ...swapFacts, action })[1] ?? "";
}

describe("a card in Telegram HTML", () => {
  it("draws the swap card of spec 4 in English, escaped", () => {
    const html = cardHtml(drawCard(swapFacts), display);
    expect(html).toContain("network ≈ &lt;$0.01");
    expect(shown(html)).toStrictEqual({
      text: [
        `${icons.waiting} Confirm swap · main · ${icons.live} Live`,
        "Sell 0.5 BNB → at least 312.4 USDT",
        "Route  KyberSwap: PancakeSwap v3 92.00%, Infinity 8.00% · impact 0.08% · max slippage 0.50%",
        "Fees   network ≈ <$0.01 · private send",
        `Check  ${icons.done} simulation: you receive 313.95 USDT · ${icons.done} USDT verified`,
        'Agent says  "Taking profit as you asked at $625"',
        "Expires at 14:32:05",
      ].join("\n"),
      entities: [],
    });
  });

  it("shows a token named <b> as text, never as a tag", () => {
    const html = cardHtml(drawCard(pepeBuyFacts), {
      ...display,
      assets: assetsWith({ symbol: "<b>" }),
    });
    expect(html).toContain("&lt;b&gt; (0x6982…1933)");
    const { text, entities } = shown(html);
    expect(entities).toStrictEqual([]);
    expect(text).toContain("Sell 0.1 BNB → at least 1,000,000 <b> (0x6982…1933)");
  });

  it("follows an unverified token's symbol with its short address everywhere", () => {
    const lines = linesOf(pepeBuyFacts);
    expect(lines).toContain(
      `Check  ${icons.done} simulation: you receive 1,000,000 PEPE (0x6982…1933) · ${icons.done} PEPE (0x6982…1933) passed the risk checks`,
    );
  });

  it("makes bidi overrides, zero-width characters and line breaks in a name visible", () => {
    const assets = assetsWith({ symbol: "PE‮PE​\n" });
    const lines = linesOf(pepeBuyFacts, { ...display, assets });
    expect(lines[1]).toBe(
      "Sell 0.1 BNB → at least 1,000,000 PE\\u{202E}PE\\u{200B}\\u{A} (0x6982…1933)",
    );
  });

  it("cuts a symbol past 16 characters and the agent's reason past 200", () => {
    const assets = assetsWith({ symbol: "A".repeat(17) });
    const facts = { ...pepeBuyFacts, reason: "x".repeat(201) };
    const lines = linesOf(facts, { ...display, assets });
    expect(lines[1]).toBe(`Sell 0.1 BNB → at least 1,000,000 ${"A".repeat(15)}… (0x6982…1933)`);
    expect(lines).toContain(`Agent says  "${"x".repeat(199)}…"`);
  });

  it("shows any outside text as text, made visible and cut, in a card Telegram parses", () => {
    fc.assert(
      fc.property(fc.string({ unit: "binary", maxLength: 300 }), (outside) => {
        const facts: CardFacts = {
          ...pepeBuyFacts,
          agentName: outside,
          reason: outside,
          action: {
            kind: "launchToken",
            symbol: outside,
            name: outside,
            venue: outside,
            pair: refs.pepe,
            firstBuy: oneUsdt,
          },
        };
        const assets = assetsWith({ symbol: outside });
        const { text, entities } = shown(cardHtml(drawCard(facts), { ...display, assets }));
        const timesShown = (length: number): number =>
          text.split(displayOutsideText(outside, length)).length - 1;
        expect(entities).toStrictEqual([]);
        expect(timesShown(16)).toBeGreaterThanOrEqual(4);
        expect(timesShown(40)).toBeGreaterThanOrEqual(3);
        expect(timesShown(200)).toBeGreaterThanOrEqual(1);
      }),
    );
  });

  it.each<[string, CardAction, string]>([
    [
      "buy",
      { kind: "buy", token: refs.pepe, spend: oneUsdt, place: { curve: "Flap" } },
      "Buy PEPE (0x6982…1933) with 1 USDT · on the Flap curve",
    ],
    [
      "sell",
      { kind: "sell", amount: oneUsdt, minOut: oneUsdt, place: { pool: "PancakeSwap v3" } },
      "Sell 1 USDT → at least 1 USDT · on PancakeSwap v3",
    ],
    ["send", { kind: "send", amount: oneUsdt, recipient }, "Send 1 USDT to 0xAbCd…Ef12"],
    [
      "revokeApproval",
      { kind: "revokeApproval", token: refs.usdt, spender: recipient },
      "Remove 0xAbCd…Ef12's approval for USDT",
    ],
    [
      "lend",
      {
        kind: "lend",
        action: "supply",
        amount: oneUsdt,
        venue: "Venus",
        healthFactor: { numerator: 37n, denominator: 20n },
      },
      "Supply 1 USDT to Venus · health factor 1.85",
    ],
    [
      "stake",
      { kind: "stake", action: "unstake", amount: oneUsdt, validator: recipient, readyInDays: 7 },
      "Unstake 1 USDT from 0xAbCd…Ef12 · ready in 7 days",
    ],
    [
      "bridge",
      { kind: "bridge", amount: oneUsdt, chain: "fake:2" as ChainRef, recipient, minutes: 15 },
      "Bridge 1 USDT to fake:2 · to 0xAbCd…Ef12 · about 15 min",
    ],
    [
      "cexOrder",
      { kind: "cexOrder", side: "buy", size: "0.5", market: "BNBUSDT", price: "612.3" },
      "Binance buy 0.5 BNBUSDT at 612.3",
    ],
    [
      "registerIdentity",
      { kind: "registerIdentity", agent: "main" },
      "Register main on chain (ERC-8004)",
    ],
    [
      "rescue",
      {
        kind: "rescue",
        address: recipient,
        tokenCount: 1,
        walletCount: 2,
        valueUsdMicros: 5_000_000n,
      },
      "Move everything to your rescue address 0xAbCd…Ef12: 1 token from 2 wallets, about $5.00",
    ],
  ])("draws a %s card's action line", (_kind, action, line) => {
    expect(actionLineOf(action)).toBe(line);
  });

  it("names why auto mode asks, with the MCP client's name shown as outside text", () => {
    const facts: CardFacts = {
      ...swapFacts,
      warnings: {
        hasUnusualName: false,
        isNewAddress: false,
        taxBps: bpsSchema.parse(300),
        autoAsk: { code: "mcp", client: "<Claude Code>" },
      },
    };
    const html = cardHtml(drawCard(facts), display);
    expect(shown(html).text).toContain("Auto mode asks you here: proposed from <Claude Code>");
    expect(html).toContain("proposed from &lt;Claude Code&gt;");
  });

  it("refuses to draw a card that names an asset without its symbol and decimals", () => {
    expect(() => cardHtml(drawCard(swapFacts), { ...display, assets: {} })).toThrow(
      expect.objectContaining({ code: "telegram.unknown_asset" }),
    );
  });

  it.each([
    [
      "an answer here",
      {
        outcome: "confirmed",
        answeredBy: { surface: "telegram", by: "tg:1" },
        atMs: cardExpiresAtMs - 25_000,
      },
      `${icons.done} Confirmed on Telegram at 14:31:40 · sending`,
    ],
    [
      "an answer in the console",
      { outcome: "denied", answeredBy: { surface: "console", by: "dev_1" }, atMs: 0 },
      `${icons.refused} Cancelled on the console`,
    ],
    ["the card timer", { outcome: "expired", atMs: 0 }, `${icons.refused} Expired with no answer`],
  ] as const)("draws the receipt of %s", (_name, closing, receipt) => {
    expect(shown(receiptHtml(closing, display)).text).toBe(receipt);
  });

  it("draws the receipt of a paper fill with what it sold and bought", () => {
    const answeredBy = { surface: "telegram", by: "tg:1" } as const;
    const closing = { outcome: "confirmed", answeredBy, atMs: 0 } as const;
    const fill = {
      amountIn: { asset: refs.bnb, base: 5n * 10n ** 17n },
      amountOut: { asset: refs.usdt, base: 31_395n * 10n ** 16n },
    };
    expect(shown(receiptHtml(closing, display, fill)).text).toBe(
      `${icons.paper} Paper fill: 0.5 BNB → 313.95 USDT`,
    );
  });
});
