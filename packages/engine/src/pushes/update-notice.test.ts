import { createFormatter } from "@binference/i18n";
import { describe, expect, it } from "vitest";
import { updateNotice } from "./update-notice.js";

describe("the update notice", () => {
  it("names the version and puts each line of the notes on its own line", () => {
    const english = createFormatter({ locale: "en", timeZone: "UTC" });
    const push = updateNotice("2026.12.0", ["Stop-loss orders fill faster.", "Fewer RPC calls."]);
    const summary = "Stop-loss orders fill faster.\nFewer RPC calls.";

    expect(push).toStrictEqual({
      topic: "notice",
      kind: "notice/new",
      data: { key: "notice.update", values: { version: "2026.12.0", summary } },
    });
    expect(english.message("notice.update", { version: "2026.12.0", summary })).toBe(
      `binference 2026.12.0 is out: ${summary}. Run \`binference update\`.`,
    );
  });

  it("goes without notes when the release has none in the owner's language", () => {
    expect(updateNotice("2026.12.0", [])).toStrictEqual({
      topic: "notice",
      kind: "notice/new",
      data: { key: "notice.updateBare", values: { version: "2026.12.0" } },
    });
  });
});
