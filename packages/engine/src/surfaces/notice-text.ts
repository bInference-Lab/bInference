import type { ChainRegistry } from "@binference/chain";
import { type Formatter, writeNotice } from "@binference/i18n";
import { assetInfoOf } from "../money-path/asset-infos.js";
import type { Notice } from "../pushes/notice-push.js";

/** What a notice is written with: the owner's formatter, and the chains its amounts name. */
export interface NoticeDisplay {
  readonly formatter: Formatter;
  readonly chains: ChainRegistry;
}

/**
 * A notice as the owner reads it (spec 4, section 4), written by i18n's `writeNotice`: each
 * amount's token as the registry lists it, else as the notice carries it (an unlisted token, cut
 * and followed by its short address), else in base units with the token's short address.
 */
export function noticeText(notice: Notice, display: NoticeDisplay): string {
  const assets = notice.assets ?? {};
  return writeNotice(notice, {
    formatter: display.formatter,
    assetInfo: (asset) => assetInfoOf(display.chains, asset) ?? assets[asset],
  });
}
