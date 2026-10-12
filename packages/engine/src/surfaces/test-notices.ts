import type { Amount } from "@binference/chain";
import { testAgent, testCoin } from "../intents/test-intents.js";
import type { Notice, NoticePart } from "../pushes/notice-push.js";

/** 2026-10-11 09:30 UTC, the moment every notice of {@link noticeTable} names. */
export const noticeTableAtMs: number = Date.UTC(2026, 9, 11, 9, 30, 0);

// Thousandths of the test chain's coin, which has 18 decimals.
const coinAmount = (thousandths: bigint): Amount => ({
  asset: testCoin,
  base: thousandths * 10n ** 15n,
});
const at = { when: noticeTableAtMs };
const agent = { agent: "main" };

const orderKind = (kind: string): NoticePart => ({ key: "order.kind", values: { kind } });

const sale: NoticePart = {
  key: "fill.sell",
  values: { received: "$12.40", price: "$0.0000075" },
  amounts: { amount: coinAmount(1_650n) },
};

const launch: NoticePart = {
  key: "launch.line",
  values: {
    token: "PEPE 0x6982…1933",
    launchpad: "Pad",
    age: "3 min",
    tax: "1%",
    insiders: "2",
    creatorLaunches: "0",
  },
  parts: { curve: { key: "launch.curve", values: { graduated: "no", progress: "42%" } } },
};

/**
 * One notice of each key of spec 4, section 4, with its sections 4.2 and 4.3, as the engine
 * publishes it: the agent it names where its words name one, its values, times, amounts and
 * parts. A surface proves it writes every notice by sending each one (Y12).
 */
export const noticeTable: Readonly<Record<string, Notice>> = {
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
  "notice.lowGas": {
    key: "notice.lowGas",
    values: { wallet: "Main" },
    amounts: { balance: coinAmount(1n) },
  },
  "notice.orderExpiring": {
    key: "notice.orderExpiring",
    values: {},
    times: at,
    parts: { orderKind: orderKind("limit") },
  },
  "notice.frozen": {
    key: "notice.frozen",
    agent: testAgent,
    values: { ...agent, surface: "telegram" },
  },
  "notice.unfrozen": {
    key: "notice.unfrozen",
    agent: testAgent,
    values: { ...agent, scope: "agent", surface: "console" },
  },
  "notice.rescue": { key: "notice.rescue", values: { address: "0x9F3c…41aB" } },
  "notice.newDevice": { key: "notice.newDevice", values: { label: "Laptop" } },
  "notice.signInsLocked": {
    key: "notice.signInsLocked",
    values: { what: "device", name: "Laptop" },
    times: { until: noticeTableAtMs },
  },
  "notice.limitChange": {
    key: "notice.limitChange",
    values: { surface: "cli", limit: "perTradeUsdMicros", pending: "yes" },
    times: at,
  },
  "notice.limitChangeCancelled": {
    key: "notice.limitChangeCancelled",
    values: { limit: "rollingDayUsdMicros" },
  },
  "notice.ceilingChange": {
    key: "notice.ceilingChange",
    agent: testAgent,
    values: { ...agent, surface: "cli", change: "cap" },
  },
  "notice.signerRevoked": {
    key: "notice.signerRevoked",
    values: { signer: "office-mac", surface: "cli" },
  },
  "notice.sendLevel": {
    key: "notice.sendLevel",
    values: { from: "2", to: "1", pending: "yes" },
    times: at,
  },
  "notice.sendLevelCancelled": {
    key: "notice.sendLevelCancelled",
    values: { to: "0", level: "2" },
  },
  "notice.rescueStopped": { key: "notice.rescueStopped", values: {} },
  "notice.rescueAddress": {
    key: "notice.rescueAddress",
    values: { address: "0x9F3c…41aB" },
    times: at,
  },
  "notice.rescueAddressCancelled": {
    key: "notice.rescueAddressCancelled",
    values: { address: "0x9F3c…41aB" },
  },
  "notice.ceilingOutdated": { key: "notice.ceilingOutdated", values: { address: "0x9F3c…41aB" } },
  "notice.plainSecret": { key: "notice.plainSecret", values: {} },
  "notice.budget": {
    key: "notice.budget",
    agent: testAgent,
    values: { ...agent, budget: "$3.00" },
    times: at,
  },
  "notice.loop": { key: "notice.loop", agent: testAgent, values: agent },
  "notice.resumed": {
    key: "notice.resumed",
    values: { duration: "2 h", checked: "3", filled: "1", skipped: "2" },
  },
  "notice.update": {
    key: "notice.update",
    values: { version: "2027.1.0", summary: "Stop-loss orders fill faster" },
  },
  "notice.updateBare": { key: "notice.updateBare", values: { version: "2027.1.0" } },
  "notice.updated": {
    key: "notice.updated",
    values: { version: "2027.1.0", summary: "Stop-loss orders fill faster" },
  },
  "notice.updatedBare": { key: "notice.updatedBare", values: { version: "2027.1.0" } },
  "notice.updateRolledBack": {
    key: "notice.updateRolledBack",
    values: { version: "2027.1.0", previous: "2026.12.2" },
  },
  "notice.backupFailed": { key: "notice.backupFailed", values: { reason: "copy" } },
  "notice.locked": { key: "notice.locked", values: {} },
  "notice.signerStopped": { key: "notice.signerStopped", values: {} },
  "notice.signerRefused": { key: "notice.signerRefused", values: { rule: "rule_3" } },
  "notice.privyUnreachable": { key: "notice.privyUnreachable", values: {} },
  "notice.configInvalid": {
    key: "notice.configInvalid",
    values: { problem: "bad_value", key: "telegram.mode" },
  },
  "notice.configChanged": {
    key: "notice.configChanged",
    values: { changed: "owner.locale", afterRestart: "none" },
  },
  "notice.unknownTx": { key: "notice.unknownTx", values: { wallet: "Main", nonce: "42" } },
  "notice.fillDiffers": { key: "notice.fillDiffers", values: {} },
  "notice.blockShared": { key: "notice.blockShared", values: { wallet: "Main" } },
  "notice.fillUnknown": { key: "notice.fillUnknown", values: {} },
  "notice.notSigned": { key: "notice.notSigned", values: {} },
  "notice.confirmationLapsed": { key: "notice.confirmationLapsed", values: {} },
  "notice.feeAboveCap": { key: "notice.feeAboveCap", values: {} },
  "notice.stepUnsent": { key: "notice.stepUnsent", values: {} },
  "notice.stepDropped": { key: "notice.stepDropped", values: {} },
  "notice.stepDroppedPartWay": { key: "notice.stepDroppedPartWay", values: {} },
  "notice.droppedLanded": { key: "notice.droppedLanded", values: {} },
  "notice.walletHeld": { key: "notice.walletHeld", values: { wallet: "Main" } },
  "notice.binanceRefused": {
    key: "notice.binanceRefused",
    agent: testAgent,
    values: { ...agent, trade: "buy $500 of CAKE" },
  },
  "notice.binancePaused": {
    key: "notice.binancePaused",
    agent: testAgent,
    values: { ...agent, surface: "mini" },
  },
  "notice.approvalMode": {
    key: "notice.approvalMode",
    agent: testAgent,
    values: { ...agent, mode: "auto", surface: "cli" },
  },
  "notice.alertPrice": {
    key: "notice.alertPrice",
    values: { token: "PEPE", direction: "above", price: "$0.00001", now: "$0.000011" },
    after: [
      { key: "alert.woke", values: agent },
      { key: "alert.wakeSkipped", values: { ...agent, count: "3" } },
    ],
  },
  "notice.alertWallet": {
    key: "notice.alertWallet",
    values: { wallet: "Whale", side: "sell", amount: "2M PEPE", share: "40%", value: "$22.10" },
  },
  "notice.alertLaunch": { key: "notice.alertLaunch", values: {}, parts: { launch } },
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
