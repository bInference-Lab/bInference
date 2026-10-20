import { BinferenceError } from "@binference/core";
import type { AssetInfo, AssetInfos, CardLineView, CardValueView } from "@binference/protocol";
import type { Formatter } from "../format/create-formatter.js";
import { decimalText } from "../format/decimal-text.js";
import { formatPercentChange, formatUsdChange } from "../format/format-amount.js";
import type { MessageValues } from "../format/format-message.js";
import { displayOutsideText } from "../format/outside-text.js";
import { addressPartOf, shortAddress } from "./short-address.js";

/** What a card is shown with: the owner's formatter, and every asset the card names. */
export interface CardDisplay {
  readonly formatter: Formatter;
  /** Each asset's symbol, decimals and verdict, set by whoever deployed the token. */
  readonly assets: AssetInfos;
}

type ValueType = CardValueView["type"];
type AssetRef = ValueOf<"asset">["asset"];
type ValueOf<T extends ValueType> = {
  readonly [P in T]: Extract<CardValueView, { readonly type: P }>;
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
// A launch's description, links and metadata address show long enough to check against what the
// owner asked (decision 0235).
const textLengths: Readonly<Record<string, number>> = {
  reason: 200,
  symbol: symbolLength,
  description: 1_000,
  url: 200,
  uri: 200,
  // A launch's picture link is at most 512 bytes, so a card shows it whole (decision 0276).
  link: 512,
};
const ratioDecimals = 2;

function say(formatter: Formatter, key: string, values?: MessageValues): string {
  return formatter.message(key, values);
}

function infoOf(asset: AssetRef, display: CardDisplay): AssetInfo {
  const info = display.assets[asset];
  if (info === undefined) {
    throw new BinferenceError({
      code: "engine.card_asset_unknown",
      message: "A card names an asset without its symbol and decimals; it is never shown so.",
      details: { asset },
    });
  }
  return info;
}

/**
 * An asset as a card names it: its symbol, cut past 16 characters and made visible, followed by
 * its short address when it is not verified. Throws `engine.card_asset_unknown` when
 * `display.assets` lacks it.
 */
export function assetText(asset: AssetRef, display: CardDisplay): string {
  const info = infoOf(asset, display);
  const symbol = displayOutsideText(info.symbol, symbolLength);
  return info.verified
    ? symbol
    : say(display.formatter, "card.value.unverifiedToken", {
        symbol,
        address: shortAddress(addressPartOf(asset)),
      });
}

function routeText(value: ValueOf<"route">, { formatter }: CardDisplay): string {
  const legs = value.legs.map((leg) =>
    say(formatter, "card.value.routeLeg", {
      venue: displayOutsideText(leg.venue, nameLength),
      share: formatter.percent(leg.shareBps),
    }),
  );
  return say(formatter, "card.value.route", {
    venue: displayOutsideText(value.venue, nameLength),
    legs: legs.join(say(formatter, "card.value.legSeparator")),
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
  dateTime: ({ atMs }, { display }) => display.formatter.dateTime(atMs),
  count: ({ count }) => count,
  choice: ({ choice }) => choice,
  text: ({ text }, { argument }) => displayOutsideText(text, textLengths[argument] ?? nameLength),
  route: (value, { display }) => routeText(value, display),
  line: ({ line }, { display }) => cardLineText(line, display),
  usdChange: ({ usdMicros }) => formatUsdChange(usdMicros),
  percentChange: ({ bps }) => formatPercentChange(bps),
};

function valueText<T extends ValueType>(value: ValueOf<T>, context: ValueContext): string | number {
  const format: (value: ValueOf<T>, context: ValueContext) => string | number = formats[value.type];
  return format(value, context);
}

/**
 * One card line as plain text in the owner's language (spec 4, section 3): its message with every
 * value formatted by the one formatter, and every outside text cut and made visible. A surface
 * escapes the whole line for its own markup. Throws `engine.card_asset_unknown` when the line names
 * an asset `display.assets` lacks.
 */
export function cardLineText(line: CardLineView, display: CardDisplay): string {
  const values = Object.entries(line.values).map(
    ([argument, value]: readonly [string, CardValueView]): readonly [string, string | number] => [
      argument,
      valueText(value, { display, argument }),
    ],
  );
  return say(display.formatter, line.key, Object.fromEntries(values));
}
