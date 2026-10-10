import type { Amount, ChainRegistry } from "@binference/chain";
import type { Formatter } from "@binference/i18n";
import { assetInfoOf } from "../money-path/asset-infos.js";
import type { Notice } from "../pushes/notice-push.js";
import { addressPartOf, shortAddress } from "./short-address.js";

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

/**
 * A notice as the owner reads it (spec 4, section 4): its message in the owner's language, with
 * each time as the day and time in the owner's timezone, and each amount in its token's units and
 * symbol. A surface sends it as plain text, or escapes it for its own markup.
 */
export function noticeText(notice: Notice, display: NoticeDisplay): string {
  const { formatter } = display;
  const times = Object.entries(notice.times ?? {}).map(
    ([name, atMs]: readonly [string, number]) => [name, formatter.dateTime(atMs)] as const,
  );
  const amounts = Object.entries(notice.amounts ?? {}).map(
    ([name, amount]: readonly [string, Amount]) => [name, amountText(amount, display)] as const,
  );
  const values = { ...notice.values, ...Object.fromEntries([...times, ...amounts]) };
  return formatter.message(notice.key, values);
}
