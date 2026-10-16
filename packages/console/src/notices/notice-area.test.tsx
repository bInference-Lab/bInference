// @vitest-environment jsdom
import { writeNotice } from "@binference/i18n";
import { noticeTable, type TableNotice } from "@binference/i18n/testing";
import { act, cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { formatterFor } from "../i18n/console-text";
import { fakeClient } from "../testing/fake-client";
import { renderSignedIn, settle } from "../testing/render-signed-in";
import { shownNoticeTable, tableCoinInfo } from "../testing/shown-notice-table";
import { NoticeArea } from "./notice-area";

afterEach(cleanup);

// Spec 4's status icons, which the console draws as line icons, and the code marks it draws as code.
const icons = /[\u{1F7E1}\u{2705}\u{274C}\u{26A0}\u{1F9EA}\u{1F534}\u{1F7E2}\u{26A1}]\u{FE0F}?|`/gu;

const ntc = (n: number): string => `ntc_0190f1c2-3a4b-7c5d-8e6f-${String(n).padStart(12, "0")}`;
const walletNotice = (n: number, wallet: string) => ({
  id: ntc(n),
  at: 1_800_000_000_000,
  key: "notice.unknownTx",
  values: { wallet, nonce: String(n) },
});

// A notice's lines as every surface writes it, without what the console draws as icons or code.
function writtenLines(notice: TableNotice): readonly string[] {
  const formatter = formatterFor("en", "UTC");
  const assetInfo: Parameters<typeof writeNotice>[1]["assetInfo"] = (asset) =>
    notice.assets?.[asset] ?? tableCoinInfo;
  const lines = writeNotice(notice, { formatter, assetInfo }).split("\n");
  return lines.map((line) => line.replace(icons, "").trim());
}

describe("the console's notice area", () => {
  it("shows every notice of spec 4 in English, in the words every surface writes (Y12)", async () => {
    const shown = await shownNoticeTable("en");
    const expected = Object.fromEntries(
      Object.entries(noticeTable).map(([key, each]) => [key, writtenLines(each)]),
    );
    const trimmed = Object.fromEntries(
      Object.entries(shown).map(([key, lines]) => [key, lines.map((line) => line.trim())]),
    );
    expect(trimmed).toStrictEqual(expected);
    expect(trimmed["notice.lowGas"]).toStrictEqual([
      "Main has 0.001 FAKE left for network fees. Add BNB.",
    ]);
    expect(trimmed["notice.locked"]).toStrictEqual([
      "binference restarted and is locked. Run binference unlock.",
    ]);
  });

  it("keeps a notice until the owner dismisses it", async () => {
    const engine = fakeClient({});
    renderSignedIn(<NoticeArea />, { client: engine.client });
    await settle();
    act(() => engine.push("notice", "notice/new", walletNotice(1, "Main")));
    act(() => engine.push("notice", "notice/new", walletNotice(2, "Spare")));
    const items = screen.getAllByRole("listitem");
    expect(items.map((item) => item.textContent?.includes("Spare"))).toStrictEqual([true, false]);
    const [dismissNewest] = screen.getAllByRole("button", { name: "Dismiss this notice" });
    fireEvent.click(dismissNewest as HTMLElement);
    expect(screen.getAllByRole("listitem")).toHaveLength(1);
    expect(screen.getByRole("listitem").textContent).toContain("Main's nonce 1");
  });

  it("reads on from its last notice after a gap, so none is missed", async () => {
    const engine = fakeClient({
      "notice/list": () => ({ items: [{ ...walletNotice(2, "Spare"), delivered: {} }] }),
    });
    renderSignedIn(<NoticeArea />, { client: engine.client });
    await settle();
    act(() => engine.push("notice", "notice/new", walletNotice(1, "Main")));
    await act(async () => engine.resync("notice"));
    expect(engine.calls.filter((call) => call.op === "notice/list")).toStrictEqual([
      { op: "notice/list", args: { cursor: ntc(1), limit: 50 } },
    ]);
    const [newest] = screen.getAllByRole("listitem");
    expect((newest as HTMLElement).textContent).toContain("Spare's nonce 2");
  });
});
