import { createFormatter } from "@binference/i18n";
import { describe, expect, it } from "vitest";
import { updatedNotice, updateNotice, updateRolledBackNotice } from "./update-notice.js";

describe("the update notice", () => {
  it("names the version and puts each line of the notes on its own line", () => {
    const english = createFormatter({ locale: "en", timeZone: "UTC" });
    const notes = ["Stop-loss orders fill faster.", "Fewer RPC calls."];
    const push = updateNotice("2026.12.0", notes, "update");
    const summary = "Stop-loss orders fill faster.\nFewer RPC calls.";
    const values = { version: "2026.12.0", steps: "update", summary };

    expect(push).toStrictEqual({
      topic: "notice",
      kind: "notice/new",
      data: { key: "notice.update", values },
    });
    expect(english.message("notice.update", values)).toBe(
      `binference 2026.12.0 is out. Run \`binference update\`. What changed: ${summary}`,
    );
  });

  it("goes without notes when the release has none in the owner's language", () => {
    expect(updateNotice("2026.12.0", [], "manual")).toStrictEqual({
      topic: "notice",
      kind: "notice/new",
      data: { key: "notice.updateBare", values: { version: "2026.12.0", steps: "manual" } },
    });
  });
});

describe("the notices of how an update ended", () => {
  it("tell the owner of the new version, and of the version put back", () => {
    const english = createFormatter({ locale: "en", timeZone: "UTC" });
    const warning = String.fromCodePoint(0x26a0, 0xfe0f);
    const values = { version: "2026.12.0", previous: "2026.11.0" };

    expect([
      updatedNotice("2026.12.0", ["Fewer RPC calls."]).data,
      updatedNotice("2026.12.0", []).data,
      updateRolledBackNotice("2026.12.0", "2026.11.0").data,
    ]).toStrictEqual([
      { key: "notice.updated", values: { version: "2026.12.0", summary: "Fewer RPC calls." } },
      { key: "notice.updatedBare", values: { version: "2026.12.0" } },
      { key: "notice.updateRolledBack", values },
    ]);
    expect(english.message("notice.updateRolledBack", values)).toBe(
      `${warning} binference 2026.12.0 did not pass after the update, so binference went back to 2026.11.0. Your settings and records are as they were before the update; messages and alerts that came while it was checked are not kept.`,
    );
  });
});
