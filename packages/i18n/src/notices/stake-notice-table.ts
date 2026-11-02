import { noticeTableParts } from "./notice-table-parts.js";
import type { WrittenNotice } from "./write-notice.js";

const { coinAmount } = noticeTableParts;

/**
 * One notice of each staking key of spec 4, section 4, as the engine publishes it: an unstake's
 * coin a claim can take now (decision 0327), and one claimed outside binference (decision 0331).
 */
export const stakeNoticeTable: Readonly<Record<string, WrittenNotice>> = {
  "notice.claimReady": {
    key: "notice.claimReady",
    values: { validator: "0x71C7…976F" },
    amounts: { amount: coinAmount(2_000n) },
  },
  "notice.claimedElsewhere": {
    key: "notice.claimedElsewhere",
    values: { validator: "0x1adB…7fE6" },
    amounts: { amount: coinAmount(2_000n) },
  },
};
