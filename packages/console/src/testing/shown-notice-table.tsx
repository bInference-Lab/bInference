import type { MessageLocale } from "@binference/i18n";
import {
  noticeTable,
  noticeTableAtMs,
  noticeTableCoin,
  type TableNotice,
} from "@binference/i18n/testing";
import type { NoticePartView } from "@binference/protocol";
import { screen } from "@testing-library/react";
import { NoticeArea } from "../notices/notice-area";
import { fakeClient } from "./fake-client";
import { renderSignedIn, settle } from "./render-signed-in";

/** The fake chain's coin as the engine's `asset/get` names it. */
export const tableCoinInfo = { symbol: "FAKE", name: "Fake", decimals: 18, verified: true };

interface PartWire {
  readonly key: string;
  readonly values: Readonly<Record<string, string>>;
  readonly times?: Readonly<Record<string, number>>;
  readonly amounts?: Readonly<Record<string, { readonly asset: string; readonly base: string }>>;
  readonly parts?: Readonly<Record<string, PartWire>>;
}

// A part as the `notice/new` push carries it: each amount's base units as decimal text.
function wireOf(part: NoticePartView): PartWire {
  const { amounts, parts, ...rest } = part;
  return {
    ...rest,
    ...(amounts === undefined
      ? {}
      : {
          amounts: Object.fromEntries(
            Object.entries(amounts).map(([name, amount]) => [
              name,
              { asset: amount.asset, base: amount.base.toString() },
            ]),
          ),
        }),
    ...(parts === undefined
      ? {}
      : {
          parts: Object.fromEntries(
            Object.entries(parts).map(([name, inner]) => [name, wireOf(inner)]),
          ),
        }),
  };
}

function pushOf(notice: TableNotice, at: number): object {
  const id = `ntc_0190f1c2-3a4b-7c5d-8e6f-${String(at + 1).padStart(12, "0")}`;
  const { after, assets, agent } = notice;
  return {
    id,
    at: noticeTableAtMs,
    ...wireOf(notice),
    ...(agent === undefined ? {} : { agent }),
    ...(after === undefined ? {} : { after: after.map(wireOf) }),
    ...(assets === undefined ? {} : { assets }),
  };
}

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
    engine.push("notice", "notice/new", pushOf(notice, at));
    // oxlint-disable-next-line eslint/no-await-in-loop -- each notice is read once it shows
    await settle();
    const newest = screen.getAllByRole("listitem")[0];
    shown.push([key, [...(newest?.querySelectorAll("p") ?? [])].map(seenText)]);
  }
  return Object.fromEntries(shown);
}
