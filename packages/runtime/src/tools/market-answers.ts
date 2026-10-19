import type { AssetInfo, CandleView, ResultOf, RiskView, ScanItem } from "@binference/protocol";
import type { ToolOutcome } from "../loop/turn-records.js";
import { outsideAnswer, plainAnswer } from "../web/web-answers.js";

// How the market tools answer the model (decision 0258): a line saying what the result holds and
// in which units, then one JSON line per token or trade with the fields a decision needs, or one
// comma-separated row per candle. Times are ISO 8601 in UTC to the second. A result that holds
// anything a market, a deployer or another wallet made is outside content (decision 0257).

/** The most characters of a deployer's word a result repeats: too few to hold an address. */
export const maxWordChars = 32;

// What a market answer holds, as its opening line names it.
const marketData = "market data: token names and symbols are their deployers' words";

/** A JSON line's fields; a field left `undefined` is left out. */
interface Line {
  readonly [field: string]: string | number | boolean | Line | readonly string[] | undefined;
}

/**
 * A deployer's word as a result repeats it: control and format characters read as spaces, and a
 * word longer than {@link maxWordChars} characters is cut with an ellipsis.
 */
export function wordOf(text: string): string {
  // Cut at code points, not at what a reader sees as one character: a combining mark counts, so a
  // word never grows past twice the limit in UTF-16 units.
  const chars = Array.from(text.replace(/[\p{Cc}\p{Cf}]/gu, " ").trim());
  return chars.length <= maxWordChars
    ? chars.join("")
    : `${chars.slice(0, maxWordChars - 1).join("")}…`;
}

// An instant as a market answer shows it: ISO 8601 in UTC, to the second.
function secondOf(atMs: number): string {
  return new Date(atMs).toISOString().replace(/\.\d{3}Z$/, "Z");
}

const textOf = (value: bigint | undefined): string | undefined => value?.toString();

// A fresh risk check as a scan shows it; token_risk reads the whole check.
function riskLine(risk: RiskView): Line {
  return {
    verdict: risk.verdict,
    flags: risk.flags.map((flag) => flag.code),
    buyTaxBps: risk.buyTaxBps,
    sellTaxBps: risk.sellTaxBps,
  };
}

function wordsOf(info: AssetInfo | undefined): Line {
  return info === undefined
    ? {}
    : { symbol: wordOf(info.symbol), name: wordOf(info.name), verified: info.verified };
}

function scanLine(item: ScanItem, info: AssetInfo | undefined): string {
  const line: Line = {
    asset: item.asset,
    ...wordsOf(info),
    launchpad: item.launchpad,
    launchedAt: item.launchedAt === undefined ? undefined : secondOf(item.launchedAt),
    priceUsdMicros: textOf(item.priceUsdMicros),
    priceScale: item.priceScale,
    liquidityUsdMicros: textOf(item.liquidityUsdMicros),
    volume24hUsdMicros: textOf(item.volume24hUsdMicros),
    change24hBps: item.change24hBps,
    curveProgressBps: item.curveProgressBps,
    graduated: item.graduated,
    activeBoosts: item.activeBoosts,
    risk: item.risk === undefined ? undefined : riskLine(item.risk),
  };
  return JSON.stringify(line);
}

const scanOpenings: Readonly<Record<"launches" | "trending", string>> = {
  launches: "Launches of the last 24 hours, newest first",
  trending: "Trending tokens, in the source's order, which paid boosts raise",
};

const priceUnits =
  "Prices are micro-dollars for 10^priceScale whole tokens, for one when priceScale is absent; liquidity and volume are micro-dollars.";

/** What `market_scan` answers: one line per token, or a plain line when none came. */
export function scanAnswer(
  source: "launches" | "trending",
  view: ResultOf<"market/scan">,
): ToolOutcome {
  if (view.items.length === 0) {
    return plainAnswer(
      source === "launches"
        ? "No launch of the last 24 hours passes the filters."
        : "The source lists no trending token on this chain now.",
    );
  }
  const lines = view.items.map((item) => scanLine(item, view.assets[item.asset]));
  const opening = `${scanOpenings[source]}: ${String(lines.length)}. ${priceUnits}`;
  return outsideAnswer(marketData, [opening, ...lines]);
}

function candleRow(candle: CandleView): string {
  const { openUsdMicros, highUsdMicros, lowUsdMicros, closeUsdMicros, volumeUsdMicros } = candle;
  const figures = [openUsdMicros, highUsdMicros, lowUsdMicros, closeUsdMicros, volumeUsdMicros];
  return [secondOf(candle.at), ...figures.map(String)].join(",");
}

/** What `chart` answers: a line naming the chart and its units, then a row per candle. */
export function chartAnswer(view: ResultOf<"market/chart">): ToolOutcome {
  if (view.candles.length === 0) {
    return plainAnswer(`No candles of ${view.asset} came from ${view.source}.`);
  }
  const per =
    view.priceScale === undefined
      ? "per whole token"
      : `for 10^${String(view.priceScale)} whole tokens`;
  const opening = `Candles of ${view.interval} for ${view.asset} from ${view.source}, oldest first: ${String(view.candles.length)}. Prices are micro-dollars ${per}; volume is micro-dollars.`;
  const rows = view.candles.map(candleRow);
  return outsideAnswer("market data", [opening, "at,open,high,low,close,volume", ...rows]);
}
