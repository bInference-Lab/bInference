import type { AccountRef, AssetRef } from "@binference/chain";
import type { Bps } from "@binference/core";
import { createFormatter, type Formatter, messages } from "@binference/i18n";
import { parseMessage } from "@binference/i18n/check";
import { describe, expect, it } from "vitest";
import type { CardLine, CardValue } from "./card-line.js";
import { type CardFacts, drawCard } from "./draw-card.js";

const bnb = "fake:1/slip44:1" as AssetRef;
const usdt = "fake:1/token:usdt" as AssetRef;
const pepe = "fake:1/token:pepe" as AssetRef;
const saved = "fake:1:saved" as AccountRef;
const symbols: Readonly<Record<string, string>> = { [bnb]: "BNB", [usdt]: "USDT", [pepe]: "PEPE" };
// The status icons of spec 4, from their code points: code and tests carry no emojis.
const icons = {
  waiting: String.fromCodePoint(0x1f7e1),
  done: String.fromCodePoint(0x2705),
  live: String.fromCodePoint(0x1f534),
};
// 14:32:05 UTC on the day of the example card.
const expiresAtMs = Date.UTC(2026, 9, 6, 14, 32, 5);

// The swap card of spec 4, section 3.2.
const swap: CardFacts = {
  agentName: "main",
  isPaper: false,
  hasOutsideContent: false,
  card: { version: 1, openedAtMs: expiresAtMs - 60_000, expiresAtMs },
  action: {
    kind: "swap",
    amountIn: { asset: bnb, base: 5n * 10n ** 17n },
    minOut: { asset: usdt, base: 31_240n * 10n ** 16n },
  },
  route: {
    venue: "KyberSwap",
    legs: [
      { venue: "PancakeSwap v3", shareBps: 9_200 as Bps },
      { venue: "Infinity", shareBps: 800 as Bps },
    ],
    priceImpactBps: 8 as Bps,
    maxSlippageBps: 50 as Bps,
  },
  fees: { networkFeeUsdMicros: 4_000n, isPrivateSend: true },
  check: {
    received: { asset: usdt, base: 31_395n * 10n ** 16n },
    token: usdt,
    isTokenVerified: true,
  },
  warnings: { hasUnusualName: false, isNewAddress: false },
  reason: "Taking profit as you asked at $625",
};

// A send with no quote, route or check: every line without facts is left out.
const send: CardFacts = {
  agentName: "main",
  isPaper: true,
  hasOutsideContent: false,
  card: { version: 1, openedAtMs: 0, expiresAtMs: 600_000 },
  action: { kind: "send", amount: { asset: usdt, base: 10n ** 18n }, recipient: saved },
  warnings: { hasUnusualName: false, isNewAddress: false },
};

// Every flag on: an outside idea to buy an unverified, taxed token with an odd name, re-quoted.
const flagged: CardFacts = {
  ...swap,
  isPaper: true,
  hasOutsideContent: true,
  card: { version: 3, openedAtMs: 0, expiresAtMs: 60_000 },
  check: { received: { asset: pepe, base: 10n ** 18n }, token: pepe, isTokenVerified: false },
  warnings: {
    hasUnusualName: true,
    isNewAddress: true,
    taxBps: 300 as Bps,
    autoAsk: { code: "mcp", client: "Claude Code" },
  },
};

function shares(value: Extract<CardValue, { type: "route" }>): string {
  const legs = value.legs.map((leg) => `${leg.venue} ${String(leg.shareBps / 100)}%`);
  return `${value.venue}: ${legs.join(", ")}`;
}

type Formats = {
  readonly [T in CardValue["type"]]: (
    display: Formatter,
    value: Extract<CardValue, { readonly type: T }>,
  ) => string | number;
};

// A surface's rendering in short: each value formatted by the one formatter.
const formats: Formats = {
  amount: (display, value) =>
    `${display.tokenAmount(value.amount.base, 18)} ${symbols[value.amount.asset] ?? ""}`,
  asset: (_display, value) => symbols[value.asset] ?? "",
  account: (_display, value) => value.account,
  chain: (_display, value) => value.chain,
  usd: (display, value) => display.usd(value.usdMicros),
  percent: (display, value) => display.percent(value.bps),
  ratio: (_display, value) => `${String(value.ratio.numerator)}/${String(value.ratio.denominator)}`,
  time: (display, value) => display.time(value.atMs),
  count: (_display, value) => value.count,
  choice: (_display, value) => value.choice,
  text: (_display, value) => value.text,
  route: (_display, value) => shares(value),
  line: (display, value) => render(display, value.line),
};

function valueText(display: Formatter, value: CardValue): string | number {
  const format = formats[value.type] as (display: Formatter, value: CardValue) => string | number;
  return format(display, value);
}

function render(display: Formatter, line: CardLine): string {
  const values = Object.entries(line.values).map(
    (entry: readonly [string, CardValue]): readonly [string, string | number] => [
      entry[0],
      valueText(display, entry[1]),
    ],
  );
  return display.message(line.key, Object.fromEntries(values));
}

function rendered(facts: CardFacts): readonly string[] {
  const display = createFormatter({ locale: "en", timeZone: "UTC" });
  return drawCard(facts).lines.map((line) => render(display, line));
}

function valuesOf(facts: CardFacts, key: string): CardLine["values"] {
  return drawCard(facts).lines.find((line) => line.key === key)?.values ?? {};
}

function argumentNames(line: CardLine): readonly string[] {
  const parsed = parseMessage(messages.en[line.key] ?? "");
  const forms = parsed.ok ? parsed.value.arguments : [];
  return forms.map((form) => form.replace(/^\{([^,}]+).*$/, "$1")).toSorted();
}

describe("drawing a card", () => {
  it("draws the example swap card of spec 4 in English", () => {
    expect(rendered(swap)).toStrictEqual([
      `${icons.waiting} Confirm swap · main · ${icons.live} Live`,
      "Sell 0.5 BNB → at least 312.4 USDT",
      "Route  KyberSwap: PancakeSwap v3 92%, Infinity 8% · impact 0.08% · max slippage 0.50%",
      "Fees   network ≈ <$0.01 · private send",
      `Check  ${icons.done} simulation: you receive 313.95 USDT · ${icons.done} USDT verified`,
      'Agent says  "Taking profit as you asked at $625"',
      "Expires at 14:32:05",
    ]);
  });

  it("drops the private send without a private relay and names an unverified token's checks", () => {
    const plain = { ...flagged, fees: { networkFeeUsdMicros: 30_000n, isPrivateSend: false } };
    expect(rendered(plain)).toStrictEqual(
      expect.arrayContaining([
        "Fees   network ≈ $0.03",
        `Check  ${icons.done} simulation: you receive 1 PEPE · ${icons.done} PEPE passed the risk checks`,
      ]),
    );
  });

  it("names the mode, the private send and the token's verdict as select values", () => {
    const plain = { ...flagged, fees: { networkFeeUsdMicros: 1n, isPrivateSend: false } };
    expect([
      valuesOf(swap, "card.header")["mode"],
      valuesOf(flagged, "card.header")["mode"],
    ]).toStrictEqual([
      { type: "choice", choice: "live" },
      { type: "choice", choice: "paper" },
    ]);
    expect([
      valuesOf(plain, "card.fees")["privateSend"],
      valuesOf(plain, "card.check")["verified"],
    ]).toStrictEqual([
      { type: "choice", choice: "no" },
      { type: "choice", choice: "no" },
    ]);
  });

  it("leaves out every line that has no facts", () => {
    expect(drawCard(send).lines.map((line) => line.key)).toStrictEqual([
      "card.header",
      "card.send.action",
      "card.warn.paper",
      "card.expiry",
    ]);
  });

  it("orders the warnings as spec 4 lists them", () => {
    const keys = drawCard(flagged).lines.map((line) => line.key);
    expect(keys.filter((key) => key.includes(".warn."))).toStrictEqual([
      "card.warn.outsideContent",
      "card.warn.unusualName",
      "card.warn.newAddress",
      "card.warn.unverified",
      "card.warn.highTax",
      "card.warn.requoted",
      "card.warn.paper",
      "card.warn.autoAsks",
    ]);
  });

  it("names why auto mode asks, with the client of an MCP proposal", () => {
    expect(rendered(flagged)).toContain("Auto mode asks you here: proposed from Claude Code");
    const overCap: CardFacts = {
      ...flagged,
      warnings: { ...flagged.warnings, autoAsk: { code: "overCap" } },
    };
    expect(rendered(overCap)).toContain("Auto mode asks you here: over your auto caps");
  });

  it("shows no tax warning for a token without tax", () => {
    const untaxed = { ...flagged, warnings: { ...flagged.warnings, taxBps: 0 as Bps } };
    const keys = drawCard(untaxed).lines.map((line) => line.key);
    expect(keys).not.toContain("card.warn.highTax");
  });

  it("keeps the agent's words as text for the surface to escape", () => {
    const words = "<b>sell</b>‮ now";
    const line = drawCard({ ...swap, reason: words }).lines.find(
      (item) => item.key === "card.reason",
    );
    expect(line?.values).toStrictEqual({ reason: { type: "text", text: words } });
  });

  it("carries its version and expiry, and gives each line exactly its message's arguments", () => {
    const card = drawCard(flagged);
    expect([card.version, card.expiresAtMs]).toStrictEqual([3, 60_000]);
    expect(card.lines.map((line) => Object.keys(line.values).toSorted())).toStrictEqual(
      card.lines.map((line) => argumentNames(line)),
    );
  });
});
