import { describe, expect, it } from "vitest";
import {
  defaultNoticeSettings,
  isNoticeMuted,
  noticeSettingsDocument,
  noticeSettingsOf,
  noticeSettingsSchema,
} from "./notice-settings.js";

// Whether new settings parse.
function parse(value: unknown): boolean {
  return noticeSettingsSchema.safeParse(value).success;
}

// Settings that mute these kinds, with the summary at 09:00.
function mutes(...muted: readonly ("fill" | "update")[]) {
  return { muted, dailySummaryTime: "09:00" };
}

describe("an agent's notice settings", () => {
  it("reads a document from before the settings as every kind on and the summary at 09:00", () => {
    expect(noticeSettingsOf({})).toStrictEqual(defaultNoticeSettings);
    expect(noticeSettingsOf({ fills: true })).toStrictEqual(defaultNoticeSettings);
    expect(noticeSettingsOf(null)).toStrictEqual(defaultNoticeSettings);
  });

  it("reads back the document it writes", () => {
    const settings = { muted: ["fill", "update"] as const, dailySummaryTime: "07:45" };
    expect(noticeSettingsOf(noticeSettingsDocument(settings))).toStrictEqual(settings);
  });

  it("drops a stored kind that cannot be muted and keeps the default of a broken field", () => {
    expect(
      noticeSettingsOf({ muted: ["frozen", "fill", "fill", 3], dailySummaryTime: "25:00" }),
    ).toStrictEqual({ muted: [], dailySummaryTime: "09:00" });
    expect(noticeSettingsOf({ muted: ["frozen", "fill", "fill"] })).toStrictEqual({
      muted: ["fill"],
      dailySummaryTime: "09:00",
    });
  });

  it("refuses new settings that mute a security notice, name a kind twice or a bad time", () => {
    expect(parse({ muted: ["lowGas"], dailySummaryTime: "00:00" })).toBe(true);
    expect(parse({ muted: ["rescue"], dailySummaryTime: "09:00" })).toBe(false);
    expect(parse({ muted: ["fill", "fill"], dailySummaryTime: "09:00" })).toBe(false);
    expect(parse({ muted: [], dailySummaryTime: "9:00" })).toBe(false);
    expect(parse({ muted: [], dailySummaryTime: "09:00", quiet: true })).toBe(false);
  });
});

describe("whether a notice is muted", () => {
  it("mutes a kind its agent muted, and never a kind that cannot be muted", () => {
    expect(isNoticeMuted("fill", [mutes("fill")])).toBe(true);
    expect(isNoticeMuted("fill", [mutes()])).toBe(false);
    expect(isNoticeMuted("frozen", [mutes("fill")])).toBe(false);
  });

  it("mutes a notice about the install only when every agent muted its kind", () => {
    expect(isNoticeMuted("update", [mutes("update"), mutes("update")])).toBe(true);
    expect(isNoticeMuted("update", [mutes("update"), mutes()])).toBe(false);
    expect(isNoticeMuted("update", [])).toBe(false);
  });
});
