import { describe, expect, it } from "vitest";
import { goal, live, noteOf, push, setUpGoalReplies } from "../testing/goal-reply-fixtures.js";

describe("a chat's goal in Telegram", () => {
  it("tells each change of the goal in a status line", async () => {
    const { botApi, show } = await setUpGoalReplies();
    await show(push("set", { goal }));
    const paused = { ...goal, status: "paused", pauseReason: "no_progress" };
    await show(push("paused", { goal: paused }));
    await show(push("cleared", {}));
    expect(botApi.messages().map((message) => message.text)).toStrictEqual([
      "Goal set: Find three tokens. The agent works on it turn after turn; /goal pause stops it.",
      "Goal paused: 3 goal turns in a row made no progress. Tell the agent what to change, then /goal resume.",
      "Goal cleared.",
    ]);
  });

  it("keeps the progress note in one message, edited in place at most once every 5 seconds", async () => {
    const { botApi, replies, clock } = await setUpGoalReplies();
    await replies.show(push("note", { goal, note: noteOf(0) }), live);
    await replies.idle();
    expect(botApi.messages().map((message) => message.text)).toStrictEqual([
      "Progress note\n0 of 2 done.\n1. Scan (in progress)\n2. Report (to do)",
    ]);
    await replies.show(push("note", { goal, note: noteOf(1) }), live);
    await clock.advance(1_000);
    expect(botApi.messages().map((message) => message.text)).toHaveLength(1);
    expect(botApi.messages()[0]?.text).toContain("0 of 2 done.");
    await clock.advance(4_000);
    await replies.idle();
    expect(botApi.messages().map((message) => message.text)).toStrictEqual([
      "Progress note\n1 of 2 done.\n1. Scan (done)\n2. Report (to do)",
    ]);
  });
});
