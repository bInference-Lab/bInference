import { noticeTableParts } from "./notice-table-parts.js";
import type { WrittenNotice } from "./write-notice.js";

const { coinAmount } = noticeTableParts;

/**
 * One notice of each bridge key of spec 4, section 4.4, as the engine publishes it: a bridge late
 * after 2 hours, a late bridge that arrived, a bridge its venue paid back, and a confirmed bridge
 * that lapsed unsigned with what held it.
 */
export const bridgeNoticeTable: Readonly<Record<string, WrittenNotice>> = {
  "notice.bridgeLate": {
    key: "notice.bridgeLate",
    values: { chain: "Base", venue: "fake-cross", statusUrl: "https://bridge.test/transfer/0xd1" },
    amounts: { amount: coinAmount(20_000n) },
  },
  "notice.bridgeArrived": {
    key: "notice.bridgeArrived",
    values: { chain: "Base", recipient: "0x71C7…976F" },
    amounts: { received: coinAmount(19_960n) },
  },
  "notice.bridgeRefunded": {
    key: "notice.bridgeRefunded",
    values: { venue: "fake-cross", chain: "Base", wallet: "Main" },
    amounts: { amount: coinAmount(20_000n) },
  },
  "notice.bridgeLapsed": {
    key: "notice.bridgeLapsed",
    values: { chain: "Base", why: "quote" },
  },
};
