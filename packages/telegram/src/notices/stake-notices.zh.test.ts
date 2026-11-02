import { describe, expect, it } from "vitest";
import { ownerId } from "../testing/update-fixtures.js";
import { sentNoticeTable } from "./notice-table-fixtures.js";
import { stakeNoticeVariants } from "./stake-notice-variants.js";

describe("the other form of the staking notice, in Chinese", () => {
  it("writes the agent's name before a claim ready for its unstake", async () => {
    const sent = await sentNoticeTable("zh", stakeNoticeVariants);
    expect(sent.chats).toStrictEqual([ownerId]);
    expect(sent.texts).toStrictEqual({
      "notice.claimReady agent": "main · 你从 0x71C7…976F 解除质押的 2 FAKE 现在可以领取",
    });
  });
});
