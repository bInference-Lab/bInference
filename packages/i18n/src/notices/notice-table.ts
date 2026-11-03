import type { ProtocolId } from "@binference/protocol";
import { bridgeNoticeTable } from "./bridge-notice-table.js";
import { dailyNothingElse, noticeTableAtMs, noticeTableParts } from "./notice-table-parts.js";
import { orderNoticeTable } from "./order-notice-table.js";
import { stakeNoticeTable } from "./stake-notice-table.js";
import type { WrittenNotice } from "./write-notice.js";

/** A notice of {@link noticeTable}: what a surface writes, and the agent it names. */
export interface TableNotice extends WrittenNotice {
  readonly agent?: ProtocolId<"agent">;
}

const { tableAgent, at, agent, coinAmount, launch, movedName, padLaunch } = noticeTableParts;

/**
 * One notice of each key of spec 4, section 4, with its sections 4.2 and 4.3, as the engine
 * publishes it: the agent it names where its words name one, its values, times, amounts and
 * parts. A surface proves it writes every notice by sending each one (Y12).
 */
export const noticeTable: Readonly<Record<string, TableNotice>> = {
  ...orderNoticeTable,
  "notice.lowGas": {
    key: "notice.lowGas",
    values: { wallet: "Main" },
    amounts: { balance: coinAmount(1n) },
  },
  "notice.daily": {
    key: "notice.daily",
    agent: tableAgent,
    values: {
      ...agent,
      live: "yes",
      paper: "yes",
      orders: "yes",
      cards: "1",
      question: "no",
      limits: "0",
      held: "0",
      ...dailyNothingElse,
    },
    parts: {
      liveLine: {
        key: "daily.value",
        values: {
          mode: "live",
          unread: "no",
          value: "$1,200.00",
          hasChange: "yes",
          change: "+$50.00",
          realized: "+$12.40",
        },
      },
      paperLine: {
        key: "daily.value",
        values: {
          mode: "paper",
          unread: "no",
          value: "$600.00",
          hasChange: "no",
          realized: "$0.00",
        },
      },
      ordersLine: { key: "daily.orders", values: { filled: "1", skipped: "1", open: "2" } },
      spendLine: { key: "daily.spend", values: { spend: "$1.20", budget: "$3.00" } },
    },
    after: [
      {
        key: "daily.skips",
        values: { count: "1" },
        parts: { reason: { key: "reason.nothing_to_sell", values: {} } },
      },
    ],
  },
  "notice.frozen": {
    key: "notice.frozen",
    agent: tableAgent,
    values: { ...agent, surface: "telegram" },
  },
  "notice.unfrozen": {
    key: "notice.unfrozen",
    agent: tableAgent,
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
    agent: tableAgent,
    values: { ...agent, surface: "cli", change: "cap" },
  },
  "notice.dayCapAdded": {
    key: "notice.dayCapAdded",
    agent: tableAgent,
    values: { ...agent, assets: "ETH" },
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
    agent: tableAgent,
    values: { ...agent, budget: "$3.00" },
    times: at,
  },
  "notice.scheduleSet": {
    key: "notice.scheduleSet",
    agent: tableAgent,
    values: { ...agent, by: "telegram", prompt: "Review my portfolio." },
    times: { next: noticeTableAtMs },
  },
  "notice.scheduleCancelled": {
    key: "notice.scheduleCancelled",
    agent: tableAgent,
    values: { ...agent, by: "agent", prompt: "Review my portfolio." },
  },
  "notice.loop": { key: "notice.loop", agent: tableAgent, values: agent },
  "notice.watcherLag": {
    key: "notice.watcherLag",
    values: { chain: "BNB Smart Chain", blocks: "14" },
  },
  "notice.watcherStopped": { key: "notice.watcherStopped", values: { chain: "BNB Smart Chain" } },
  "notice.walletOverflow": {
    key: "notice.walletOverflow",
    values: { wallet: "Whale", blocks: "3" },
  },
  "notice.watcherUnpriced": {
    key: "notice.watcherUnpriced",
    values: { chain: "BNB Smart Chain", count: "2", token: "0x9F3c…41aB" },
  },
  "notice.resumed": {
    key: "notice.resumed",
    values: { cause: "start", checked: "3", filled: "1", skipped: "2" },
    parts: { duration: { key: "pnl.hours", values: { count: "2" } } },
    after: [
      {
        key: "resume.skips",
        values: { count: "1" },
        parts: { reason: { key: "reason.trigger_not_met", values: {} } },
      },
      { key: "resume.other", values: { count: "1" } },
    ],
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
  "notice.webhookPortTaken": { key: "notice.webhookPortTaken", values: { port: "7457" } },
  "notice.webhookRotated": {
    key: "notice.webhookRotated",
    values: { name: "BNB breakout", surface: "cli" },
  },
  "notice.pluginHostRefused": {
    key: "notice.pluginHostRefused",
    values: { plugin: "fear-index", host: "other.example.net" },
  },
  "notice.pluginStopped": { key: "notice.pluginStopped", values: { plugin: "fear-index" } },
  "notice.pluginHostsHeld": {
    key: "notice.pluginHostsHeld",
    values: { plugin: "fear-index", count: "3" },
  },
  "notice.pluginStalled": { key: "notice.pluginStalled", values: { plugin: "fear-index" } },
  "notice.pluginSandboxOff": { key: "notice.pluginSandboxOff", values: { reason: "childProcess" } },
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
  "notice.confirmationLapsed": { key: "notice.confirmationLapsed", values: { kind: "trade" } },
  "notice.feeAboveCap": { key: "notice.feeAboveCap", values: {} },
  "notice.launchUnsent": { key: "notice.launchUnsent", values: { reason: "launch_moved" } },
  "notice.nameMoved": { key: "notice.nameMoved", values: movedName },
  ...stakeNoticeTable,
  ...bridgeNoticeTable,
  "notice.identityMismatch": { key: "notice.identityMismatch", values: agent },
  "notice.identityDuplicate": { key: "notice.identityDuplicate", values: agent },
  "notice.launchStopped": {
    key: "notice.launchStopped",
    values: { ...padLaunch, reason: "pin_timeout" },
  },
  "notice.launchNotSigned": { key: "notice.launchNotSigned", values: padLaunch },
  "notice.launchStepUnsent": {
    key: "notice.launchStepUnsent",
    values: padLaunch,
    amounts: { approved: coinAmount(6_000n) },
  },
  "notice.stepUnsent": { key: "notice.stepUnsent", values: {} },
  "notice.stepDropped": { key: "notice.stepDropped", values: {} },
  "notice.stepDroppedPartWay": { key: "notice.stepDroppedPartWay", values: {} },
  "notice.droppedLanded": { key: "notice.droppedLanded", values: {} },
  "notice.walletHeld": { key: "notice.walletHeld", values: { wallet: "Main" } },
  "notice.binanceRefused": {
    key: "notice.binanceRefused",
    agent: tableAgent,
    values: { ...agent, trade: "buy $500 of CAKE" },
  },
  "notice.binancePaused": {
    key: "notice.binancePaused",
    agent: tableAgent,
    values: { ...agent, surface: "mini" },
  },
  "notice.approvalMode": {
    key: "notice.approvalMode",
    agent: tableAgent,
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
  "notice.alertHeld": { key: "notice.alertHeld", agent: tableAgent, values: { count: "12" } },
};
