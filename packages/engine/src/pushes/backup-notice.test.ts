import { createFormatter } from "@binference/i18n";
import { describe, expect, it } from "vitest";
import { backupFailedNotice, backupFailedNoticeKey } from "./backup-notice.js";

const warning = String.fromCodePoint(0x26a0, 0xfe0f);

describe("the backup failed notice", () => {
  it("names the reason in plain words, on the notice topic", () => {
    const english = createFormatter({ locale: "en", timeZone: "UTC" });
    const push = backupFailedNotice("write");

    expect(push).toStrictEqual({
      topic: "notice",
      kind: "notice/new",
      data: { key: backupFailedNoticeKey, values: { reason: "write" } },
    });
    expect(english.message(backupFailedNoticeKey, { reason: "write" })).toBe(
      `${warning} Last night's backup failed: the backup file could not be written; check the disk's free space`,
    );
    expect(english.message(backupFailedNoticeKey, { reason: "check" })).toBe(
      `${warning} Last night's backup failed: reading it back found a part that does not match`,
    );
  });
});
