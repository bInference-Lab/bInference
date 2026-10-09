import { createFormatter } from "@binference/i18n";
import { describe, expect, it } from "vitest";
import { lockedNoticeKey, signerStoppedNoticeKey } from "./locked-notice.js";

const alarm = String.fromCodePoint(0x1f534);

describe("the locked notice in Chinese", () => {
  it("tells the owner to run binference unlock", () => {
    const chinese = createFormatter({ locale: "zh", timeZone: "UTC" });
    expect(chinese.message(lockedNoticeKey)).toBe(
      `${alarm} binference 已重启并处于锁定状态。请运行 \`binference unlock\`。`,
    );
  });

  it("tells the owner the signer stopped, and how to start it again", () => {
    const chinese = createFormatter({ locale: "zh", timeZone: "UTC" });
    expect(chinese.message(signerStoppedNoticeKey)).toBe(
      `${alarm} 签名进程已停止，binference 不会签名。请先处理 \`binference logs\` 显示的问题，再运行 \`binference unlock\`。`,
    );
  });
});
