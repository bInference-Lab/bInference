import type { MessageLocale } from "@binference/i18n";
import { noticeTable, noticeTableCoin, noticeTablePush } from "@binference/i18n/testing";
import { screen } from "@testing-library/react";
import { NoticeArea } from "../notices/notice-area";
import { fakeClient } from "./fake-client";
import { renderSignedIn, settle } from "./render-signed-in";

/** The fake chain's coin as the engine's `asset/get` names it. */
export const tableCoinInfo = { symbol: "FAKE", name: "Fake", decimals: 18, verified: true };

// A line's words as the owner reads them: without the names of its icons, read to screen readers.
function seenText(line: Element): string {
  const seen = line.cloneNode(true);
  if (seen instanceof Element) {
    seen.querySelectorAll(".sr-only").forEach((hidden) => hidden.remove());
  }
  return seen.textContent ?? "";
}

/**
 * Pushes every notice of the notice table to the console's notice area, in key order, in the
 * locale, in UTC, and answers the lines each key showed, without its icons' names.
 */
export async function shownNoticeTable(
  locale: MessageLocale,
): Promise<Readonly<Record<string, readonly string[]>>> {
  const engine = fakeClient({
    "asset/get": () => ({ asset: noticeTableCoin, ...tableCoinInfo }),
  });
  renderSignedIn(<NoticeArea />, { client: engine.client, locale });
  await settle();
  const shown: [string, readonly string[]][] = [];
  for (const [at, [key, notice]] of Object.entries(noticeTable).entries()) {
    engine.push("notice", "notice/new", noticeTablePush(notice, at + 1));
    // oxlint-disable-next-line eslint/no-await-in-loop -- each notice is read once it shows
    await settle();
    const newest = screen.getAllByRole("listitem")[0];
    shown.push([key, [...(newest?.querySelectorAll("p") ?? [])].map(seenText)]);
  }
  return Object.fromEntries(shown);
}
