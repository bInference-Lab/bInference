import type { Amount, ChainRegistry } from "@binference/chain";
import { addressPartOf, displayOutsideText, type Formatter, shortAddress } from "@binference/i18n";
import type { AssetInfo, AssetInfos } from "@binference/protocol";
import { assetInfoOf } from "../money-path/asset-infos.js";
import type { Notice, NoticePart } from "../pushes/notice-push.js";

/** What a notice is written with: the owner's formatter, and the chains its amounts name. */
export interface NoticeDisplay {
  readonly formatter: Formatter;
  readonly chains: ChainRegistry;
}

/** A display with the infos the notice carries of tokens the registry does not list. */
interface NoticeContext extends NoticeDisplay {
  readonly assets: AssetInfos;
}

// Spec 4, section 1: a symbol is cut past 16 characters.
const symbolLength = 16;

// A token's symbol: the registry's as it is; an unverified one cut, made visible and followed by
// its short address, as a card shows it.
function symbolText(amount: Amount, info: AssetInfo, display: NoticeContext): string {
  if (info.verified) {
    return info.symbol;
  }
  return display.formatter.message("card.value.unverifiedToken", {
    symbol: displayOutsideText(info.symbol, symbolLength),
    address: shortAddress(addressPartOf(amount.asset)),
  });
}

// An amount in its token's units and symbol, or in base units with the token's short address
// when neither the registry nor the notice knows it.
function amountText(amount: Amount, display: NoticeContext): string {
  const info = assetInfoOf(display.chains, amount.asset) ?? display.assets[amount.asset];
  return info === undefined
    ? `${amount.base.toString()} ${shortAddress(addressPartOf(amount.asset))}`
    : `${display.formatter.tokenAmount(amount.base, info.decimals)} ${symbolText(amount, info, display)}`;
}

// A message with its arguments filled in: each time as the day and time in the owner's timezone,
// each amount in its token's units and symbol, and each part as its own message, written first.
function messageText(part: NoticePart, display: NoticeContext): string {
  const { formatter } = display;
  const times = Object.entries(part.times ?? {}).map(
    ([name, atMs]: readonly [string, number]) => [name, formatter.dateTime(atMs)] as const,
  );
  const amounts = Object.entries(part.amounts ?? {}).map(
    ([name, amount]: readonly [string, Amount]) => [name, amountText(amount, display)] as const,
  );
  const parts = Object.entries(part.parts ?? {}).map(
    ([name, inner]: readonly [string, NoticePart]) => [name, messageText(inner, display)] as const,
  );
  const values = { ...part.values, ...Object.fromEntries([...times, ...amounts, ...parts]) };
  return formatter.message(part.key, values);
}

/**
 * A notice as the owner reads it (spec 4, section 4): its message in the owner's language, with
 * each time as the day and time in the owner's timezone, each amount in its token's units and
 * symbol (an unlisted token's as the notice carries it, followed by its short address), each part
 * as its own message, and each message that follows it on a line of its own. A surface sends it as
 * plain text, or escapes it for its own markup.
 */
export function noticeText(notice: Notice, display: NoticeDisplay): string {
  const context = { ...display, assets: notice.assets ?? {} };
  const after = (notice.after ?? []).map((part) => messageText(part, context));
  return [messageText(notice, context), ...after].join("\n");
}
