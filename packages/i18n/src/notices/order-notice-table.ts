import type { ProtocolId } from "@binference/protocol";
import { noticeTableParts } from "./notice-table-parts.js";
import type { WrittenNotice } from "./write-notice.js";

const { tableAgent, at, orderKind, sale } = noticeTableParts;

/**
 * One notice of each auto order and fill key of spec 4, section 4.3, as the engine publishes it:
 * a fill and a skip, an order that ends soon or filled past its most, a fill nothing valued, fills
 * that keep failing, an approval reset, a copy order's and a webhook rule's held notices, and the
 * exit orders a sale ended.
 */
export const orderNoticeTable: Readonly<
  Record<string, WrittenNotice & { readonly agent?: ProtocolId<"agent"> }>
> = {
  "notice.fill": {
    key: "notice.fill",
    values: { mode: "paper" },
    parts: { orderKind: orderKind("takeProfit"), result: sale },
  },
  "notice.skipped": {
    key: "notice.skipped",
    values: {},
    parts: {
      orderKind: orderKind("stopLoss"),
      reason: { key: "reason.nothing_to_sell", values: {} },
    },
  },
  "notice.orderExpiring": {
    key: "notice.orderExpiring",
    values: {},
    times: at,
    parts: { orderKind: orderKind("limit") },
  },
  "notice.orderOverfilled": {
    key: "notice.orderOverfilled",
    values: { fills: "2", maxFills: "1" },
    parts: { orderKind: orderKind("stopLoss") },
  },
  "notice.fillUnvalued": {
    key: "notice.fillUnvalued",
    values: {},
    parts: { orderKind: orderKind("limit") },
  },
  "notice.fillsFailing": {
    key: "notice.fillsFailing",
    values: { count: "5" },
    parts: { orderKind: orderKind("takeProfit") },
  },
  "notice.approvalReset": { key: "notice.approvalReset", values: { token: "PEPE" } },
  "notice.copyHeld": { key: "notice.copyHeld", agent: tableAgent, values: { count: "12" } },
  "notice.webhookHeld": {
    key: "notice.webhookHeld",
    agent: tableAgent,
    values: { name: "BNB breakout", count: "12" },
  },
  "notice.webhookSkipped": {
    key: "notice.webhookSkipped",
    values: {},
    parts: {
      orderKind: { key: "fill.webhookRule", values: { name: "BNB breakout" } },
      reason: { key: "reason.late", values: {} },
    },
  },
  "notice.ordersEnded": {
    key: "notice.ordersEnded",
    values: { token: "PEPE", count: "2" },
    parts: { orderKind: orderKind("takeProfit") },
  },
  "notice.exitEnded": {
    key: "notice.exitEnded",
    values: { token: "PEPE" },
    parts: { orderKind: orderKind("trailing") },
  },
};
