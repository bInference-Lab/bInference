import { createFormatter } from "@binference/i18n";
import { describe, expect, it } from "vitest";
import { lockedNotice, lockedNoticeKey } from "./locked-notice.js";

const alarm = String.fromCodePoint(0x1f534);

describe("the locked notice", () => {
  it("reaches every reading client on the notice topic and names no agent", () => {
    expect(lockedNotice()).toStrictEqual({
      topic: "notice",
      kind: "notice/new",
      data: { key: "notice.locked", values: {} },
    });
  });

  it("tells the owner to run binference unlock", () => {
    const english = createFormatter({ locale: "en", timeZone: "UTC" });
    expect(english.message(lockedNoticeKey)).toBe(
      `${alarm} binference restarted and is locked. Run \`binference unlock\`.`,
    );
  });
});
