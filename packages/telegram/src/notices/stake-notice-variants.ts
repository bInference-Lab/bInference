import { testAgent } from "@binference/engine/testing";
import { noticeTableCoin, type TableNotice } from "@binference/i18n/testing";

/**
 * The other form of the staking notice of spec 4, section 4.4, beside the one the notice table
 * sends: a claim ready for an agent's unstake, naming the agent as the engine publishes it, so the
 * chat writes the agent's name before words that do not name it. Keyed by the notice's key and the
 * form it takes.
 */
export const stakeNoticeVariants: Readonly<Record<string, TableNotice>> = {
  "notice.claimReady agent": {
    key: "notice.claimReady",
    agent: testAgent,
    values: { validator: "0x71C7…976F" },
    amounts: { amount: { asset: noticeTableCoin, base: 2n * 10n ** 18n } },
  },
};
