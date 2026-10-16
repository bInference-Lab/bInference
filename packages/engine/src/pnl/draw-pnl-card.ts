import { mulDiv } from "@binference/core";
import { addressPartOf, shortAddress } from "@binference/i18n";
import type { AssetInfo } from "@binference/protocol";
import type { CardLine, CardValue } from "../confirmations/card-line.js";
import type { PositionFigures } from "./position-figures.js";

/** What a P&L card is drawn from: the position's figures, its agent, and its asset's info. */
export interface PnlCardFacts {
  readonly figures: PositionFigures;
  readonly agentName: string;
  /** The asset's symbol and decimals; absent when neither the registry nor an intent knows it. */
  readonly info?: AssetInfo;
}

const bpsPerWhole = 10_000n;
const minuteMs = 60_000;
const hourMs = 60 * minuteMs;
const dayMs = 24 * hourMs;

const usd = (usdMicros: bigint): CardValue => ({ type: "usd", usdMicros });
const change = (usdMicros: bigint): CardValue => ({ type: "usdChange", usdMicros });
const dateTime = (atMs: number): CardValue => ({ type: "dateTime", atMs });

// A share of its base in basis points, rounded toward minus infinity, so a gain never shows larger
// and a loss never smaller (decision 0243); a base of zero has no share.
function percentOf(pnlUsdMicros: bigint, baseUsdMicros: bigint): CardValue {
  if (baseUsdMicros <= 0n) {
    return { type: "line", line: { key: "pnl.noPercent", values: {} } };
  }
  const scaled = pnlUsdMicros * bpsPerWhole;
  const quotient = scaled / baseUsdMicros;
  const bps = scaled % baseUsdMicros < 0n ? quotient - 1n : quotient;
  return { type: "percentChange", bps };
}

// The units a held time is counted in, the largest first.
const durationUnits = [
  { key: "pnl.days", unitMs: dayMs },
  { key: "pnl.hours", unitMs: hourMs },
  { key: "pnl.minutes", unitMs: minuteMs },
] as const;

// How long a closed position was held, in whole days, else whole hours, else whole minutes.
function durationOf(heldMs: number): CardValue {
  const { key, unitMs } = durationUnits.find((unit) => heldMs >= unit.unitMs) ?? durationUnits[2];
  const count: CardValue = { type: "count", count: Math.floor(heldMs / unitMs) };
  return { type: "line", line: { key, values: { count } } };
}

function headerLine(
  { figures, agentName, info }: PnlCardFacts,
  key: "pnl.header" | "pnl.headerClosed",
): CardLine {
  const token: CardValue =
    info === undefined
      ? { type: "text", text: shortAddress(addressPartOf(figures.asset)) }
      : { type: "asset", asset: figures.asset };
  const values = {
    token,
    agent: { type: "text", text: agentName },
    mode: { type: "choice", choice: figures.isPaper ? "paper" : "live" },
  } as const;
  return { key, values };
}

function feesLine(figures: PositionFigures): CardLine {
  const values = {
    venue: usd(figures.venueFeeUsdMicros),
    network: usd(figures.networkFeeUsdMicros),
  };
  return { key: "pnl.fees", values };
}

// The holding and cost lines need the token's decimals; without them they are left out (spec 4,
// section 3.1). The average cost per whole token is a value at the time, so it rounds up.
function holdingLines(figures: PositionFigures, info: AssetInfo | undefined): readonly CardLine[] {
  if (info === undefined) {
    return [];
  }
  const amount: CardValue = {
    type: "amount",
    amount: { asset: figures.asset, base: figures.quantityBase },
  };
  const holding: CardLine =
    figures.valueUsdMicros === undefined
      ? { key: "pnl.holdingNoValue", values: { amount } }
      : { key: "pnl.holding", values: { amount, value: usd(figures.valueUsdMicros) } };
  const whole = { numerator: 10n ** BigInt(info.decimals), denominator: figures.quantityBase };
  const average = mulDiv(figures.costUsdMicros, whole, "up");
  const cost = { average: usd(average), cost: usd(figures.costUsdMicros) };
  return [holding, { key: "pnl.cost", values: cost }];
}

function openLines(facts: PnlCardFacts): readonly CardLine[] {
  const { figures } = facts;
  const realized = change(figures.realizedUsdMicros);
  const pnl: CardLine =
    figures.valueUsdMicros === undefined
      ? { key: "pnl.noPrice", values: { realized } }
      : {
          key: "pnl.open",
          values: {
            unrealized: change(figures.valueUsdMicros - figures.costUsdMicros),
            percent: percentOf(
              figures.valueUsdMicros - figures.costUsdMicros,
              figures.costUsdMicros,
            ),
            realized,
          },
        };
  const since: readonly CardLine[] =
    figures.openedAtMs === undefined
      ? []
      : [{ key: "pnl.since", values: { openedAt: dateTime(figures.openedAtMs) } }];
  return [
    headerLine(facts, "pnl.header"),
    ...holdingLines(figures, facts.info),
    pnl,
    feesLine(figures),
    ...since,
  ];
}

function closedLines(facts: PnlCardFacts): readonly CardLine[] {
  const { figures } = facts;
  const trades = { bought: usd(figures.boughtUsdMicros), sold: usd(figures.soldUsdMicros) };
  const closed = {
    realized: change(figures.realizedUsdMicros),
    percent: percentOf(figures.realizedUsdMicros, figures.boughtUsdMicros),
  };
  const { openedAtMs, changedAtMs } = figures;
  const held: readonly CardLine[] =
    openedAtMs === undefined
      ? []
      : [
          {
            key: "pnl.held",
            values: {
              openedAt: dateTime(openedAtMs),
              closedAt: dateTime(changedAtMs),
              duration: durationOf(changedAtMs - openedAtMs),
            },
          },
        ];
  return [
    headerLine(facts, "pnl.headerClosed"),
    { key: "pnl.trades", values: trades },
    { key: "pnl.closed", values: closed },
    feesLine(figures),
    ...held,
  ];
}

/**
 * The lines of a position's P&L card (spec 4, section 3.7; decision 0243): an open card while the
 * position holds units, else a closed one. Money stays in micro-dollars and every percentage is
 * worked out from integers; a position with no price now says so instead of guessing a value.
 */
export function drawPnlCard(facts: PnlCardFacts): readonly CardLine[] {
  return facts.figures.quantityBase > 0n ? openLines(facts) : closedLines(facts);
}
