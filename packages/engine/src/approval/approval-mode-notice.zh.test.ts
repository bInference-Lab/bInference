import { createFormatter } from "@binference/i18n";
import { describe, expect, it } from "vitest";
import { approvalModeNoticeKey } from "./approval-mode-notice.js";

const chinese = createFormatter({ locale: "zh", timeZone: "UTC" });

function say(mode: string, surface: string): string {
  return chinese.message(approvalModeNoticeKey, { agent: "main", mode, surface });
}

describe("the approval mode notice in Chinese", () => {
  it("names the agent, its new mode and the surface in the glossary's words", () => {
    expect([say("auto", "console"), say("manual", "cli")]).toStrictEqual([
      "main 已切换为自动模式，来自 控制台",
      "main 已切换为手动模式，来自 命令行",
    ]);
  });
});
