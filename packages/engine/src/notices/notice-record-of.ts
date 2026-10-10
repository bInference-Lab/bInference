import type { Id } from "@binference/core";
import { messages } from "@binference/i18n";
import type { Notice } from "../pushes/notice-push.js";
import type {
  NoticeDeliveries,
  NoticeLevel,
  NoticeRecord,
  NoticeSurface,
} from "./notice-record.js";

/** The message area of the owner notices of spec 4, section 4, which the store keeps. */
export const noticeArea = "notice.";

// The status icons a notice's English message opens with (spec 4, section 1): the red circle and
// the warning sign.
const criticalIcon = String.fromCodePoint(0x1f534);
const warningIcon = String.fromCodePoint(0x26a0);

function levelOf(key: string): NoticeLevel {
  const text = messages.en[key] ?? "";
  if (text.startsWith(criticalIcon)) {
    return "critical";
  }
  return text.startsWith(warningIcon) ? "warning" : "info";
}

/** When and where a notice is stored: its new id, its time and the surfaces that deliver it. */
export interface NoticeStamp {
  readonly id: Id<"ntc">;
  readonly atMs: number;
  readonly surfaces: readonly NoticeSurface[];
}

/**
 * The record a notice of the `notice.` area is stored as (decision 0133): its kind is its name,
 * the key after `notice.`; its level is `critical` when its English message opens with the red
 * circle, `warning` with the warning sign, and `info` otherwise; each surface's delivery starts
 * `queued`.
 */
export function noticeRecordOf(notice: Notice, stamp: NoticeStamp): NoticeRecord {
  const delivered: NoticeDeliveries = Object.fromEntries(
    stamp.surfaces.map((surface) => [surface, "queued"] as const),
  );
  return {
    id: stamp.id,
    atMs: stamp.atMs,
    notice,
    kind: notice.key.slice(noticeArea.length),
    level: levelOf(notice.key),
    delivered,
  };
}
