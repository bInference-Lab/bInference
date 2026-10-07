import { BinferenceError } from "@binference/core";
import {
  type Card,
  type CardClosing,
  type CardLine,
  type CardValue,
  receiptLine,
} from "@binference/engine";
import { decimalText, type Formatter, type MessageValues } from "@binference/i18n";
import type { AssetInfo, AssetInfos } from "@binference/protocol";
import { escapeHtml } from "../format/escape-html.js";
import { displayOutsideText } from "../format/outside-text.js";
import { addressPartOf, shortAddress } from "../format/short-address.js";

/** What a card is shown with: the owner's formatter, and every asset the card names. */
export interface CardDisplay {
  readonly formatter: Formatter;
  /** Each asset's symbol, decimals and verdict, set by whoever deployed the token. */
  readonly assets: AssetInfos;
}

type ValueType = CardValue["type"];
type AssetRef = ValueOf<"asset">["asset"];
type ValueOf<T extends ValueType> = {
  readonly [P in T]: Extract<CardValue, { readonly type: P }>;
}[T];

/** Where a value goes: the display, and the name of the argument it fills. */
interface ValueContext {
  readonly display: CardDisplay;
  readonly argument: string;
}

type ValueFormats = {
  readonly [T in ValueType]: (value: ValueOf<T>, context: ValueContext) => string | number;
};

// Spec 4, section 1: a symbol is cut past 16 characters, a name past 40, the agent's reason
// past 200. Every other outside text is a name.
const symbolLength = 16;
const nameLength = 40;
const textLengths: Readonly<Record<string, number>> = { reason: 200, symbol: symbolLength };
const ratioDecimals = 2;

function say(formatter: Formatter, key: string, values?: MessageValues): string {
  // oxlint-disable-next-line eslint/no-restricted-properties -- the formatter's message method picks i18n text by key; no error message is read
  return formatter.message(key, values);
}

function infoOf(asset: AssetRef, display: CardDisplay): AssetInfo {
  const info = display.assets[asset];
  if (info === undefined) {
    throw new BinferenceError({
      code: "telegram.unknown_asset",
      message: "A card names an asset without its symbol and decimals; it is never shown so.",
      details: { asset },
    });
  }
  return info;
}

function assetText(asset: AssetRef, display: CardDisplay): string {
  const info = infoOf(asset, display);
  const symbol = displayOutsideText(info.symbol, symbolLength);
  return info.verified
    ? symbol
    : say(display.formatter, "telegram.card.unverifiedToken", {
        symbol,
        address: shortAddress(addressPartOf(asset)),
      });
}

function routeText(value: ValueOf<"route">, { formatter }: CardDisplay): string {
  const legs = value.legs.map((leg) =>
    say(formatter, "telegram.card.routeLeg", {
      venue: displayOutsideText(leg.venue, nameLength),
      share: formatter.percent(leg.shareBps),
    }),
  );
  return say(formatter, "telegram.card.route", {
    venue: displayOutsideText(value.venue, nameLength),
    legs: legs.join(say(formatter, "telegram.card.legSeparator")),
  });
}

const formats: ValueFormats = {
  amount: ({ amount }, { display }) => {
    const { decimals } = infoOf(amount.asset, display);
    return `${display.formatter.tokenAmount(amount.base, decimals)} ${assetText(amount.asset, display)}`;
  },
  asset: ({ asset }, { display }) => assetText(asset, display),
  account: ({ account }) => shortAddress(addressPartOf(account)),
  chain: ({ chain }) => chain,
  usd: ({ usdMicros }, { display }) => display.formatter.usd(usdMicros),
  percent: ({ bps }, { display }) => display.formatter.percent(bps),
  ratio: ({ ratio }) =>
    decimalText(
      (ratio.numerator * 10n ** BigInt(ratioDecimals)) / ratio.denominator,
      ratioDecimals,
    ),
  time: ({ atMs }, { display }) => display.formatter.time(atMs),
  count: ({ count }) => count,
  choice: ({ choice }) => choice,
  text: ({ text }, { argument }) => displayOutsideText(text, textLengths[argument] ?? nameLength),
  route: (value, { display }) => routeText(value, display),
  line: ({ line }, { display }) => lineText(line, display),
};

function valueText<T extends ValueType>(value: ValueOf<T>, context: ValueContext): string | number {
  const format: (value: ValueOf<T>, context: ValueContext) => string | number = formats[value.type];
  return format(value, context);
}

// A line as plain text: its message in the owner's language, every value formatted and shown.
function lineText(line: CardLine, display: CardDisplay): string {
  const values = Object.entries(line.values).map(
    ([argument, value]: readonly [string, CardValue]): readonly [string, string | number] => [
      argument,
      valueText(value, { display, argument }),
    ],
  );
  return say(display.formatter, line.key, Object.fromEntries(values));
}

/**
 * A card version as Telegram HTML, one line per card line (spec 4, section 3). Each line is
 * filled in as plain text, then escaped whole: a token named `<b>` shows as `<b>`, never as bold.
 * Throws `telegram.unknown_asset` when the card names an asset `display.assets` lacks.
 */
export function cardHtml(card: Card, display: CardDisplay): string {
  return card.lines.map((line) => escapeHtml(lineText(line, display))).join("\n");
}

/** The receipt a card becomes when it closes (spec 4, section 3.5), as Telegram HTML. */
export function receiptHtml(closing: CardClosing, display: CardDisplay): string {
  return escapeHtml(lineText(receiptLine(closing), display));
}
