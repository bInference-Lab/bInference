import { createFormatter } from "@binference/i18n";
import { describe, expect, it } from "vitest";
import { backupFailedNoticeKey } from "./backup-notice.js";

const warning = String.fromCodePoint(0x26a0, 0xfe0f);

describe("the backup failed notice in Chinese", () => {
  it("names the reason in plain words", () => {
    const chinese = createFormatter({ locale: "zh", timeZone: "UTC" });

    expect(chinese.message(backupFailedNoticeKey, { reason: "copy" })).toBe(
      `${warning} 昨晚的备份失败：无法在 backups.copyTo 中写入第二份副本`,
    );
    expect(chinese.message(backupFailedNoticeKey, { reason: "no_owner_key" })).toBe(
      `${warning} 昨晚的备份失败：binference 没有可用来加密备份的所有者密钥`,
    );
  });
});
