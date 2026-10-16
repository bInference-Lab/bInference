import type { Amount, AssetRef } from "@binference/chain";
import type { AssetInfo, AssetInfos, NoticePartView } from "@binference/protocol";
import { addressPartOf, shortAddress } from "../cards/short-address.js";
import type { Formatter } from "../format/create-formatter.js";
import { displayOutsideText } from "../format/outside-text.js";

/** A notice as a surface writes it: its message and arguments, and the messages that follow it. */
export interface WrittenNotice extends NoticePartView {
  readonly after?: readonly NoticePartView[];
  /** The info of each token its amounts name that the registry does not list (decision 0199). */
  readonly assets?: AssetInfos;
}

/** What a notice is written with: the owner's formatter, and the info of each asset it names. */
export interface NoticeWriting {
  readonly formatter: Formatter;
  /** The asset's symbol and decimals, or `undefined` when neither the surface nor the notice knows it. */
  readonly assetInfo: (asset: AssetRef) => AssetInfo | undefined;
}

// Spec 4, section 1: a symbol is cut past 16 characters.
const symbolLength = 16;

// A token's symbol: a verified one as it is; an unverified one cut, made visible and followed by
// its short address, as a card shows it.
function symbolText(amount: Amount, info: AssetInfo, formatter: Formatter): string {
  if (info.verified) {
    return info.symbol;
  }
  return formatter.message("card.value.unverifiedToken", {
    symbol: displayOutsideText(info.symbol, symbolLength),
    address: shortAddress(addressPartOf(amount.asset)),
  });
}

// An amount in its token's units and symbol, or in base units with the token's short address
// when nothing knows the token.
function amountText(amount: Amount, writing: NoticeWriting): string {
  const { formatter } = writing;
  const info = writing.assetInfo(amount.asset);
  return info === undefined
    ? `${amount.base.toString()} ${shortAddress(addressPartOf(amount.asset))}`
    : `${formatter.tokenAmount(amount.base, info.decimals)} ${symbolText(amount, info, formatter)}`;
}

// A message with its arguments filled in: each time as the day and time in the owner's timezone,
// each amount in its token's units and symbol, and each part as its own message, written first.
function messageText(part: NoticePartView, writing: NoticeWriting): string {
  const { formatter } = writing;
  const times = Object.entries(part.times ?? {}).map(
    ([name, atMs]: readonly [string, number]) => [name, formatter.dateTime(atMs)] as const,
  );
  const amounts = Object.entries(part.amounts ?? {}).map(
    ([name, amount]: readonly [string, Amount]) => [name, amountText(amount, writing)] as const,
  );
  const parts = Object.entries(part.parts ?? {}).map(
    ([name, inner]: readonly [string, NoticePartView]) =>
      [name, messageText(inner, writing)] as const,
  );
  const values = { ...part.values, ...Object.fromEntries([...times, ...amounts, ...parts]) };
  return formatter.message(part.key, values);
}

/**
 * A notice as the owner reads it (spec 4, section 4), the same on every surface: its message in
 * the owner's language, with each time as the day and time in the owner's timezone, each amount in
 * its token's units and symbol (an unverified token's cut and followed by its short address), each
 * part as its own message, and each message that follows it on a line of its own. A surface shows
 * it as plain text, or escapes it for its own markup.
 */
export function writeNotice(notice: WrittenNotice, writing: NoticeWriting): string {
  const after = (notice.after ?? []).map((part) => messageText(part, writing));
  return [messageText(notice, writing), ...after].join("\n");
}
