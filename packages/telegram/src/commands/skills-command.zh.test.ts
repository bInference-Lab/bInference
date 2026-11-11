import { describe, expect, it } from "vitest";
import { cleanProposal, skillEngine } from "../testing/skill-command-fixtures.js";
import { ownerId } from "../testing/update-fixtures.js";
import { startCommandBot } from "./test-command-bot.js";

describe("the /skills command in Chinese", () => {
  it("shows the proposals, their findings and the waiting skill in Chinese, and applies one", async () => {
    const engine = skillEngine();
    const bot = await startCommandBot(engine.handlers, { locale: "zh" });
    await bot.send("/skills");
    const messages = bot.botApi.messages();
    expect(messages.map(({ text }) => text.split("\n")[0])).toStrictEqual([
      "修改技能“dip-buyer”：Buys a listed token after a fall.",
      "新技能“setup-helper”：Sets up a tool.",
      "⚠️ Agent 工作区中的技能“planted”为新增或已更改，因此不会加载。接受之前请检查 workspace/planted/SKILL.md 中的文件。",
    ]);
    expect(messages[0]?.text.split("\n")[1]).toBe("原因：You asked me to buy smaller dips.");
    expect(messages[1]?.text).toContain(
      "⚠️ 扫描发现了问题，无法应用。请拒绝它，或让 Agent 修改：\nSKILL.md，第 6 行：pipe_to_shell",
    );
    expect(messages.map(({ buttons }) => buttons?.flat().map(({ text }) => text))).toStrictEqual([
      ["应用", "拒绝"],
      ["拒绝"],
      ["接受"],
    ]);
    const [first] = messages.map(({ messageId }) => messageId);
    await bot.receive(
      bot.botApi.press({
        from: ownerId,
        data: `bnf1:k:a:${cleanProposal.proposal}`,
        messageId: Number(first),
      }),
    );
    expect(bot.botApi.messages()[0]?.text).toBe("已应用。该技能从 Agent 的下一轮起加载。");
  });
});
