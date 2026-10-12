import { describe, expect, it } from "vitest";
import { ownerPhoto, startIntake } from "./chat-intake-fixtures.js";

const live = { signal: new AbortController().signal };

describe("the owner's chat intake in Chinese", () => {
  it("refuses a sixth photo, and the fifth, and says so in Chinese", async () => {
    const { clock, intake, posts, texts } = startIntake("zh");
    for (const updateId of [1, 2, 3, 4, 5, 6]) {
      // oxlint-disable-next-line eslint/no-await-in-loop -- an album's photos come one by one
      await intake.take(ownerPhoto(updateId, { albumId: "a1" }), live);
    }
    await clock.advance(300);
    await intake.idle();
    expect(posts.map((post) => post.images?.length)).toStrictEqual([4]);
    expect(texts()).toStrictEqual([
      "Agent 每条消息最多读取 4 张图片，因此有 2 张图片未发送。请在另一条消息中发送。",
    ]);
  });
});
