import { type CardDisplay, cardLineText, createFormatter } from "@binference/i18n";
import { describe, expect, it } from "vitest";
import { type CardLine, cardKeys } from "../confirmations/card-line.js";
import { drawPnlCard } from "./draw-pnl-card.js";
import {
  handWorked,
  handWorkedOnPaper,
  pricesNow,
  pricesWithoutToken,
  token,
  tokenFigures,
  tokenInfo,
} from "./pnl-fixtures.js";
import type { PositionFigures } from "./position-figures.js";

const paper = String.fromCodePoint(0x1f9ea);
const red = String.fromCodePoint(0x1f534);
const hourMs = 3_600_000;
// When the hand-worked example's first buy landed.
const openedAtMs = Date.UTC(2026, 9, 2, 14, 5);

const display: CardDisplay = {
  formatter: createFormatter({ locale: "zh", timeZone: "UTC" }),
  assets: { [token]: tokenInfo },
};

function rendered(figures: PositionFigures): readonly string[] {
  return drawPnlCard({ figures, agentName: "main", info: tokenInfo }).map((line) =>
    cardLineText(line, display),
  );
}

// A line's key and the keys of the lines nested in its values.
function keysOf(line: CardLine): readonly string[] {
  const nested = Object.values(line.values).flatMap((value) =>
    value.type === "line" ? keysOf(value.line) : [],
  );
  return [line.key, ...nested];
}

describe("a P&L card in Chinese", () => {
  it("draws every line of the card in the owner's language", async () => {
    const [open, closed, paperOpen, unpriced] = await Promise.all([
      tokenFigures(handWorked.slice(0, 3), pricesNow),
      tokenFigures(handWorked, pricesNow),
      tokenFigures(handWorkedOnPaper.slice(0, 3), pricesNow),
      tokenFigures(handWorked.slice(0, 3), pricesWithoutToken),
    ]);
    const brief = { ...closed, boughtUsdMicros: 0n, changedAtMs: openedAtMs + 2 * hourMs };
    const instant = { ...brief, changedAtMs: openedAtMs + 60_000 };
    expect({
      open: rendered(open),
      closed: rendered(closed),
      paper: rendered(paperOpen)[0],
      unpriced: rendered(unpriced).slice(1, 4),
      brief: rendered(brief).slice(2),
      instant: rendered(instant).at(-1),
    }).toStrictEqual({
      open: [
        `TKN · main · ${red} 实盘`,
        "持有 698.25 TKN · 市值 $642.39",
        "平均成本 $0.66 · 成本 $460.31",
        "盈亏 未实现盈亏 +$182.08（+39.55%）· 已实现盈亏 +$97.13",
        "费用 平台手续费 $3.70 · 网络费 $0.88",
        "开始于 2026年10月2日 14:05:00",
      ],
      closed: [
        `TKN · main · ${red} 实盘 · 已清仓`,
        "买入花费 $922.92 · 卖出收到 $1,221.15",
        "盈亏 已实现盈亏 +$298.23（+32.31%）",
        "费用 平台手续费 $5.36 · 网络费 $1.14",
        "持有 2026年10月2日 14:05:00 → 2026年10月9日 09:12:00（6 天）",
      ],
      paper: `TKN · main · ${paper} 模拟`,
      unpriced: [
        "持有 698.25 TKN",
        "平均成本 $0.66 · 成本 $460.31",
        "盈亏 未实现盈亏：暂无价格 · 已实现盈亏 +$97.13",
      ],
      brief: [
        "盈亏 已实现盈亏 +$298.23（不适用）",
        "费用 平台手续费 $5.36 · 网络费 $1.14",
        "持有 2026年10月2日 14:05:00 → 2026年10月2日 16:05:00（2 小时）",
      ],
      instant: "持有 2026年10月2日 14:05:00 → 2026年10月2日 14:06:00（1 分钟）",
    });
  });

  it("covers every key of the P&L card", async () => {
    const figures = await tokenFigures(handWorked, pricesNow);
    const drawn = new Set(
      [
        figures,
        { ...figures, boughtUsdMicros: 0n, changedAtMs: openedAtMs + hourMs },
        { ...figures, changedAtMs: openedAtMs },
        await tokenFigures(handWorked.slice(0, 3), pricesNow),
        await tokenFigures(handWorked.slice(0, 3), new Map()),
      ].flatMap((each) =>
        drawPnlCard({ figures: each, agentName: "main", info: tokenInfo }).flatMap(keysOf),
      ),
    );
    const pnlKeys = cardKeys.filter((key) => key.startsWith("pnl."));
    expect(pnlKeys.filter((key) => !drawn.has(key))).toStrictEqual([]);
  });
});
