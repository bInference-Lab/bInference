import { createFormatter } from "@binference/i18n";
import { describe, expect, it } from "vitest";
import { lockoutNoticeKey } from "./lockout-notice.js";

describe("the lockout notice in Chinese", () => {
  it("says what is locked and until when", () => {
    const chinese = createFormatter({ locale: "zh", timeZone: "UTC" });
    const values = { what: "token", name: "mcp-codex-session", until: "21:05" };
    expect(chinese.message(lockoutNoticeKey, values)).toBe(
      "⚠️ 访问令牌 mcp-codex-session 的登录失败次数过多，binference 在 21:05 前拒绝这些登录。这些尝试都没有登录成功。",
    );
  });
});
