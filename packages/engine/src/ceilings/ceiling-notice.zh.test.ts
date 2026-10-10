import { createFormatter } from "@binference/i18n";
import { describe, expect, it } from "vitest";
import { ceilingChangeKey } from "./ceiling-notice.js";

const chinese = createFormatter({ locale: "zh", timeZone: "UTC" });

function say(change: string, surface = "cli"): string {
  return chinese.message(ceilingChangeKey, { agent: "main", surface, change });
}

describe("the ceiling change notice in Chinese", () => {
  it("names the agent, the surface and what moved in the glossary's words", () => {
    expect([say("venues"), say("cap", "console"), say("both")]).toStrictEqual([
      "⚠️ 已从 命令行 用所有者密钥修改 main 钱包的上限：合约调用可以使用的平台。不是你操作？请立即冻结。",
      "⚠️ 已从 控制台 用所有者密钥修改 main 钱包的上限：一次合约调用最多可携带的金额。不是你操作？请立即冻结。",
      "⚠️ 已从 命令行 用所有者密钥修改 main 钱包的上限：合约调用可以使用的平台，以及一次合约调用最多可携带的金额。不是你操作？请立即冻结。",
    ]);
  });
});
