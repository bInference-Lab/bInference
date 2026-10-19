import type { AssetRef } from "@binference/chain";
import type { NoticePartView } from "@binference/protocol";
import type { WrittenNotice } from "./write-notice.js";

function partAssets(part: NoticePartView): readonly AssetRef[] {
  const own = Object.values(part.amounts ?? {}).map((amount) => amount.asset);
  return [...own, ...Object.values(part.parts ?? {}).flatMap(partAssets)];
}

/**
 * The assets a notice's amounts name, in its message, its parts and the messages after it, that
 * the notice carries no info of: the tokens the registry lists, which a surface away from the
 * engine reads with `asset/get` before it writes the notice. Each asset once, in order.
 */
export function noticeAssetsToRead(notice: WrittenNotice): readonly AssetRef[] {
  const named = [notice, ...(notice.after ?? [])].flatMap(partAssets);
  return [...new Set(named)].filter((asset) => notice.assets?.[asset] === undefined);
}
