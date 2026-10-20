import { bpsSchema } from "@binference/core";
import { type CardAction, drawCard } from "@binference/engine";
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

  it("says in Chinese that a trade has no time limit", () => {
    const facts = { ...swapFacts, warnings: { ...swapFacts.warnings, hasNoDeadline: true } };
    expect(textOf(cardHtml(drawCard(facts), display)).split("\n")).toContain(
      `${String.fromCodePoint(0x26a0, 0xfe0f)} 此交易没有时限：如有延迟，之后仍可能成交，但绝不会低于至少收到的数量`,
    );
  });

  it("follows an unverified token's symbol with its short address in full-width brackets", () => {
    const lines = textOf(cardHtml(drawCard(pepeBuyFacts), display)).split("\n");
    expect(lines[1]).toBe("卖出 0.1 BNB → 至少收到 1,000,000 PEPE（0x6982…1933）");
  });

  const sale = {
    kind: "sell",
    amount: { asset: refs.usdt, base: 10n ** 18n },
    minOut: { asset: refs.bnb, base: 10n ** 16n },
    place: { curve: "Flap" },
  } as const satisfies CardAction;

  it.each<[string, CardAction, string]>([
    [
      "a buy on a curve",
      {
        kind: "buy",
        token: refs.usdt,
        spend: { asset: refs.bnb, base: 10n ** 17n },
        place: { curve: "Flap" },
      },
      "用 0.1 BNB 买入 USDT · 在 Flap 联合曲线",
    ],
    [
      "a buy in the pools",
      {
        kind: "buy",
        token: refs.usdt,
        spend: { asset: refs.bnb, base: 10n ** 17n },
        place: { pool: "KyberSwap" },
      },
      "用 0.1 BNB 买入 USDT · 在 KyberSwap",
    ],
    ["a sale of an amount", sale, "卖出 1 USDT → 至少收到 0.01 BNB · 在 Flap 联合曲线"],
    [
      "a sale of a share",
      { ...sale, share: bpsSchema.parse(5_000), place: { pool: "KyberSwap" } },
      "卖出你持有的 USDT 的 50.00%（1 USDT）→ 至少收到 0.01 BNB · 在 KyberSwap",
    ],
    [
      "a sale of all of it",
      { ...sale, share: bpsSchema.parse(10_000) },
      "卖出你持有的全部 USDT（1 USDT）→ 至少收到 0.01 BNB · 在 Flap 联合曲线",
    ],
  ])("draws %s in Chinese", (_name, action, line) => {
    const lines = textOf(cardHtml(drawCard({ ...swapFacts, action }), display)).split("\n");
    expect(lines[1]).toBe(line);
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
    expect(textOf(receiptHtml(confirmed, display, { kind: "paper", fill }))).toBe(
      `${icons.paper} 模拟成交：0.5 BNB → 313.95 USDT`,
    );
    const explorerLink = `https://bscscan.com/tx/0x${"ab".repeat(32)}`;
    const token = refs.usdt;
    expect(
      [
        { kind: "filled", fill, explorerLink } as const,
        { kind: "launched", token, fill, explorerLink } as const,
        { kind: "launched", token, explorerLink } as const,
        { kind: "landed", explorerLink } as const,
        { kind: "failed", reason: "reverted", explorerLink } as const,
      ].map((after) => textOf(receiptHtml(confirmed, display, after))),
    ).toStrictEqual([
      `${icons.done} 已完成：0.5 BNB → 313.95 USDT · ${explorerLink}`,
      `${icons.done} 已发射 USDT：首笔买入 0.5 BNB → 313.95 USDT · ${explorerLink}`,
      `${icons.done} 已发射 USDT · ${explorerLink}`,
      `${icons.done} 已在链上完成 · ${explorerLink}`,
      expect.stringMatching(
        new RegExp(`^${icons.refused} 链上失败：.+ · ${explorerLink.replaceAll(".", "\\.")}$`, "u"),
      ),
    ]);
  });

  it("draws a confirmed card that ended without sending in Chinese", () => {
    const answeredBy = { surface: "telegram", by: "tg:1" } as const;
    const confirmed = { outcome: "confirmed", answeredBy, atMs: 0 } as const;
    expect(
      [{ kind: "unsent" } as const, { kind: "done" } as const, { kind: "unknown" } as const].map(
        (after) => textOf(receiptHtml(confirmed, display, after)),
      ),
    ).toStrictEqual([
      `${icons.refused} 未发送：在签名之前已结束`,
      `${icons.done} 已完成，无需在链上发送`,
      `${String.fromCodePoint(0x26a0)}${String.fromCodePoint(0xfe0f)} 已发送，结果待确认；正在检查链上记录`,
    ]);
  });
});
