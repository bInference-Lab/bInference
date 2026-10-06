import type { AssetRef } from "@binference/chain";
import type { Bps } from "@binference/core";
import { createFormatter } from "@binference/i18n";
import { describe, expect, it } from "vitest";
import type { CardValue } from "./card-line.js";
import { type CardFacts, drawCard } from "./draw-card.js";

const bnb = "fake:1/slip44:1" as AssetRef;
const usdt = "fake:1/token:usdt" as AssetRef;
const symbols: Readonly<Record<string, string>> = { [bnb]: "BNB", [usdt]: "USDT" };
const display = createFormatter({ locale: "zh", timeZone: "UTC" });
const icons = {
  waiting: String.fromCodePoint(0x1f7e1),
  done: String.fromCodePoint(0x2705),
  live: String.fromCodePoint(0x1f534),
};
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

type Formats = {
  readonly [T in CardValue["type"]]: (value: Extract<CardValue, { readonly type: T }>) => string;
};

// A surface's rendering in short, as in the English test.
const formats: Formats = {
  amount: (value) =>
    `${display.tokenAmount(value.amount.base, 18)} ${symbols[value.amount.asset] ?? ""}`,
  asset: (value) => symbols[value.asset] ?? "",
  account: (value) => value.account,
  chain: (value) => value.chain,
  usd: (value) => display.usd(value.usdMicros),
  percent: (value) => display.percent(value.bps),
  ratio: (value) => `${String(value.ratio.numerator)}/${String(value.ratio.denominator)}`,
  time: (value) => display.time(value.atMs),
  count: (value) => String(value.count),
  choice: (value) => value.choice,
  text: (value) => value.text,
  route: (value) => {
    const legs = value.legs.map((leg) => `${leg.venue} ${String(leg.shareBps / 100)}%`);
    return `${value.venue}: ${legs.join(", ")}`;
  },
  line: (value) => value.line.key,
};

function valueText(value: CardValue): string {
  const format = formats[value.type] as (value: CardValue) => string;
  return format(value);
}

describe("drawing a card in Chinese", () => {
  it("draws the example swap card of spec 4", () => {
    const lines = drawCard(swap).lines.map((line) =>
      display.message(
        line.key,
        Object.fromEntries(
          Object.entries(line.values).map((entry: readonly [string, CardValue]) => [
            entry[0],
            valueText(entry[1]),
          ]),
        ),
      ),
    );
    expect(lines).toStrictEqual([
      `${icons.waiting} 确认兑换 · main · ${icons.live} 实盘`,
      "卖出 0.5 BNB → 至少收到 312.4 USDT",
      "路由  KyberSwap: PancakeSwap v3 92%, Infinity 8% · 价格影响 0.08% · 滑点上限 0.50%",
      "费用  网络费约 <$0.01 · 私密发送",
      `检查  ${icons.done} 模拟：你将收到 313.95 USDT · ${icons.done} USDT 已验证`,
      "Agent 说明  “Taking profit as you asked at $625”",
      "过期时间 14:32:05",
    ]);
  });
});
