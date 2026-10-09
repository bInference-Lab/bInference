import { createFormatter } from "@binference/i18n";
import { describe, expect, it } from "vitest";
import { unfrozenNoticeKey } from "./write-unfreeze.js";

const green = String.fromCodePoint(0x1f7e2);
const chinese = createFormatter({ locale: "zh", timeZone: "Asia/Shanghai" });

describe("the unfrozen notice in Chinese", () => {
  it("names the agent, or every agent, and the surface in the glossary's words", () => {
    expect(
      chinese.message(unfrozenNoticeKey, { scope: "agent", agent: "main", surface: "console" }),
    ).toBe(`${green} 已从 控制台 对 main 解除冻结。`);
    expect(chinese.message(unfrozenNoticeKey, { scope: "install", surface: "telegram" })).toBe(
      `${green} 已从 Telegram 对全部 Agent 解除冻结。`,
    );
  });
});
