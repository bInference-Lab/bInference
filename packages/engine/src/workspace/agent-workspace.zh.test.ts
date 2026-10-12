import { createManualClock, createMemoryWorkspaceFiles } from "@binference/core/testing";
import { describe, expect, it } from "vitest";
import { testAgent } from "../intents/test-intents.js";
import { makeAgentWorkspace } from "./agent-workspace.js";

const signal = new AbortController().signal;
const files = createMemoryWorkspaceFiles(createManualClock(1));

async function textOf(file: string): Promise<string | undefined> {
  const read = await files.read({ agent: testAgent, file }, signal);
  return read.ok ? read.value.text : undefined;
}

describe("a new agent's workspace in Chinese", () => {
  it("makes the files in the owner's language", async () => {
    const made = {
      agent: testAgent,
      name: "小助手",
      locale: "zh",
      timeZone: "Asia/Shanghai",
    } as const;
    await makeAgentWorkspace(files, made, signal);
    expect(await textOf("OWNER.md")).toBe(
      "# 所有者\n\n- 语言：中文\n- 时区：Asia/Shanghai\n- 如何称呼你：\n",
    );
    expect(await textOf("RULES.md")).toContain("小助手 每一轮都遵守的规则。");
    expect(await textOf("FIRST-CHAT.md")).toContain("「跳过」会结束提问");
  });
});
