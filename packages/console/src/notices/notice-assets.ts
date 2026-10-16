import type { NoticePartView, NoticePushView } from "@binference/protocol";

/** An asset a notice's amount names. */
export type NoticeAsset = NonNullable<NoticePartView["amounts"]>[string]["asset"];

function partAssets(part: NoticePartView): readonly NoticeAsset[] {
  const own = Object.values(part.amounts ?? {}).map((amount) => amount.asset);
  return [...own, ...Object.values(part.parts ?? {}).flatMap(partAssets)];
}

/**
 * The assets a notice's amounts name, in its message, its parts and the messages after it, that
 * the notice carries no info of: the tokens the registry lists, which the console reads from the
 * engine with `asset/get`.
 */
export function assetsToReadOf(notice: NoticePushView): readonly NoticeAsset[] {
  const named = [notice, ...(notice.after ?? [])].flatMap(partAssets);
  return [...new Set(named)].filter((asset) => notice.assets?.[asset] === undefined);
}
