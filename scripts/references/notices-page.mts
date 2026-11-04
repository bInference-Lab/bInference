import type { AssetRef } from "@binference/chain";
import { idSchema } from "@binference/core";
import { isMutableNoticeKind, noticeRecordOf } from "@binference/engine/notices";
import { type Formatter, writeNotice } from "@binference/i18n";
import { noticeTable, noticeTableCoin, type TableNotice } from "@binference/i18n/testing";
import type { AssetInfo } from "@binference/protocol";
import { code, type ReferencePage } from "./reference-page.mjs";

// The notice table's coin reads as BNB, the coin of the chain binference trades on.
const coinInfo: AssetInfo = { symbol: "BNB", name: "BNB", decimals: 18, verified: true };

const stamp = {
  id: idSchema("ntc").parse("ntc_00000000-0000-7000-8000-000000000000"),
  atMs: 0,
  surfaces: [],
};

function exampleOf(notice: TableNotice, formatter: Formatter): string {
  const assetInfo = (asset: AssetRef): AssetInfo | undefined =>
    notice.assets?.[asset] ?? (asset === noticeTableCoin ? coinInfo : undefined);
  return writeNotice(notice, { formatter, assetInfo });
}

function noticeSection(notice: TableNotice, formatter: Formatter): string {
  const record = noticeRecordOf(notice, stamp);
  const mutable = isMutableNoticeKind(record.kind) ? "docs.yes" : "docs.no";
  const facts = formatter.message("docs.notices.facts", {
    level: formatter.message(`docs.notices.level.${record.level}`),
    mutable: formatter.message(mutable),
  });
  return [
    `## ${code(record.kind)}`,
    "",
    facts,
    "",
    "```text",
    exampleOf(notice, formatter),
    "```",
    "",
  ].join("\n");
}

function render(formatter: Formatter): string {
  const sections = Object.values(noticeTable).map((notice) => noticeSection(notice, formatter));
  return [formatter.message("docs.notices.intro"), "", ...sections].join("\n");
}

/**
 * The reference of every notice, each with the example the notice table holds for it, written as
 * each surface writes it, at 09:30 UTC on 11 October 2026.
 */
export const noticesPage: ReferencePage = { name: "notices", file: "notices", render };
