import { describe, expect, it } from "vitest";
import { goal, noteOf, push, setUpGoalReplies } from "../testing/goal-reply-fixtures.js";

describe("a chat's goal in Telegram, in Chinese", () => {
  it("writes the goal's status line and its progress note in Chinese", async () => {
    const { botApi, replies, clock, show } = await setUpGoalReplies("zh");
    await show(push("set", { goal, note: noteOf(1) }));
    await clock.advance(1_100);
    await replies.idle();
    expect(botApi.messages().map((message) => message.text)).toStrictEqual([
      "已设定目标：Find three tokens。Agent 会一轮接一轮地推进；用 /goal pause 暂停，停止推进。",
      "进度说明\n1 of 2 done.\n1. Scan（已完成）\n2. Report（待办）",
    ]);
  });
});
