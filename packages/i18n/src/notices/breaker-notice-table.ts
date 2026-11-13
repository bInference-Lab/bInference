import { noticeTableParts } from "./notice-table-parts.js";
import type { WrittenNotice } from "./write-notice.js";

const { coinAmount } = noticeTableParts;

/**
 * One notice of each breaker key of spec 4, section 4, as the engine publishes it (decision 0441):
 * the pull, the lift with an agent the owner's own freeze still holds, and an approval a fill left.
 * The pull and the lift name no agent.
 */
export const breakerNoticeTable: Readonly<Record<string, WrittenNotice>> = {
  "notice.breakerPulled": { key: "notice.breakerPulled", values: {} },
  "notice.breakerLifted": {
    key: "notice.breakerLifted",
    values: { frozen: "some" },
    lists: { agents: ["main", "second"] },
  },
  "notice.breakerApprovalLeft": {
    key: "notice.breakerApprovalLeft",
    values: { wallet: "0x9F3c…41aB", spender: "0x10ED…024E" },
    amounts: { approved: coinAmount(1_800n) },
  },
};
