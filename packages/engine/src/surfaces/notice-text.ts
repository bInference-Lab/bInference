import type { Amount, ChainRegistry } from "@binference/chain";
import { addressPartOf, type Formatter, shortAddress } from "@binference/i18n";
import { assetInfoOf } from "../money-path/asset-infos.js";
import type { Notice, NoticePart } from "../pushes/notice-push.js";

/** What a notice is written with: the owner's formatter, and the chains its amounts name. */
export interface NoticeDisplay {
  readonly formatter: Formatter;
  readonly chains: ChainRegistry;
}

// An amount in its token's units and symbol, or in base units with the token's short address
// when the registry does not know it.
function amountText(amount: Amount, display: NoticeDisplay): string {
  const info = assetInfoOf(display.chains, amount.asset);
  return info === undefined
    ? `${amount.base.toString()} ${shortAddress(addressPartOf(amount.asset))}`
    : `${display.formatter.tokenAmount(amount.base, info.decimals)} ${info.symbol}`;
}

// A message with its arguments filled in: each time as the day and time in the owner's timezone,
// each amount in its token's units and symbol, and each part as its own message, written first.
function messageText(part: NoticePart, display: NoticeDisplay): string {
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
 * symbol, each part as its own message, and each message that follows it on a line of its own. A
 * surface sends it as plain text, or escapes it for its own markup.
 */
export function noticeText(notice: Notice, display: NoticeDisplay): string {
  const after = (notice.after ?? []).map((part) => messageText(part, display));
  return [messageText(notice, display), ...after].join("\n");
}
