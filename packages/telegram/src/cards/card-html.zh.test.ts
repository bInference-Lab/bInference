import { drawCard } from "@binference/engine";
import { createFormatter } from "@binference/i18n";
import { describe, expect, it } from "vitest";
import {
  assetsWith,
  cardExpiresAtMs,
  pepeBuyFacts,
  refs,
  swapFacts,
} from "../testing/card-fixtures.js";
import { parseFakeHtml } from "../testing/fake-html.js";
import { type CardDisplay, cardHtml, receiptHtml } from "./card-html.js";

const icons = {
  waiting: String.fromCodePoint(0x1f7e1),
  done: String.fromCodePoint(0x2705),
  refused: String.fromCodePoint(0x274c),
  live: String.fromCodePoint(0x1f534),
  paper: String.fromCodePoint(0x1f9ea),
};
const display: CardDisplay = {
  formatter: createFormatter({ locale: "zh", timeZone: "UTC" }),
  assets: assetsWith(),
};

function textOf(html: string): string {
  const parsed = parseFakeHtml(html);
  return parsed.ok ? parsed.value.text : parsed.error;
}

describe("a card in Telegram HTML, in Chinese", () => {
  it("draws the swap card of spec 4 in Chinese", () => {
    expect(textOf(cardHtml(drawCard(swapFacts), display)).split("\n")).toStrictEqual([
      `${icons.waiting} 确认兑换 · main · ${icons.live} 实盘`,
      "卖出 0.5 BNB → 至少收到 312.4 USDT",
      "路由  KyberSwap：PancakeSwap v3 92.00%，Infinity 8.00% · 价格影响 0.08% · 滑点上限 0.50%",
      "费用  网络费约 <$0.01 · 私密发送",
      `检查  ${icons.done} 模拟：你将收到 313.95 USDT · ${icons.done} USDT 已验证`,
      "Agent 说明  “Taking profit as you asked at $625”",
      "过期时间 14:32:05",
    ]);
  });

  it("follows an unverified token's symbol with its short address in full-width brackets", () => {
    const lines = textOf(cardHtml(drawCard(pepeBuyFacts), display)).split("\n");
    expect(lines[1]).toBe("卖出 0.1 BNB → 至少收到 1,000,000 PEPE（0x6982…1933）");
  });

  it("draws the receipts in Chinese", () => {
    const answeredBy = { surface: "telegram", by: "tg:1" } as const;
    const confirmed = { outcome: "confirmed", answeredBy, atMs: cardExpiresAtMs } as const;
    expect(textOf(receiptHtml(confirmed, display))).toBe(
      `${icons.done} 已于 14:32:05 在 Telegram 确认 · 发送中`,
    );
    expect(textOf(receiptHtml({ outcome: "expired", atMs: 0 }, display))).toBe(
      `${icons.refused} 未回复，已过期`,
    );
    const fill = {
      amountIn: { asset: refs.bnb, base: 5n * 10n ** 17n },
      amountOut: { asset: refs.usdt, base: 31_395n * 10n ** 16n },
    };
    expect(textOf(receiptHtml(confirmed, display, fill))).toBe(
      `${icons.paper} 模拟成交：0.5 BNB → 313.95 USDT`,
    );
  });
});
