import { createFormatter } from "@binference/i18n";
import { describe, expect, it } from "vitest";
import { lockedNoticeKey } from "./locked-notice.js";

const alarm = String.fromCodePoint(0x1f534);

describe("the locked notice in Chinese", () => {
  it("tells the owner to run binference unlock", () => {
    const chinese = createFormatter({ locale: "zh", timeZone: "UTC" });
    expect(chinese.message(lockedNoticeKey)).toBe(
      `${alarm} binference 已重启并处于锁定状态。请运行 \`binference unlock\`。`,
    );
  });
});
