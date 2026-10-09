import { createFormatter } from "@binference/i18n";
import { describe, expect, it } from "vitest";
import { frozenNoticeKey } from "./freeze-agents.js";

const alarm = String.fromCodePoint(0x1f534);
const chinese = createFormatter({ locale: "zh", timeZone: "Asia/Shanghai" });

describe("the frozen notice in Chinese", () => {
  it("names the agent and the surface in the glossary's words", () => {
    expect(chinese.message(frozenNoticeKey, { agent: "main", surface: "console" })).toBe(
      `${alarm} 已从 控制台 冻结 main。请在命令行、控制台或 Mini App 中解除冻结。`,
    );
  });
});
