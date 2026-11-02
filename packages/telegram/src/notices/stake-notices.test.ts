import { describe, expect, it } from "vitest";
import { ownerId } from "../testing/update-fixtures.js";
import { sentNoticeTable } from "./notice-table-fixtures.js";
import { stakeNoticeVariants } from "./stake-notice-variants.js";

describe("the other form of the staking notice, in English", () => {
  it("writes the agent's name before a claim ready for its unstake", async () => {
    const sent = await sentNoticeTable("en", stakeNoticeVariants);
    expect(sent.chats).toStrictEqual([ownerId]);
    expect(sent.texts).toStrictEqual({
      "notice.claimReady agent": "main · 2 FAKE you unstaked from 0x71C7…976F can be claimed now",
    });
  });
});
