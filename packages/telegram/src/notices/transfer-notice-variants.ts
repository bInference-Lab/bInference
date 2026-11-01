import { noticeTableAtMs, noticeTableCoin, type TableNotice } from "@binference/i18n/testing";
import { base58Recipient } from "../testing/transfer-card-fixtures.js";

const received = { asset: noticeTableCoin, base: 19_960n * 10n ** 15n };
const rescue = { agent: "main", address: "0x9F3c…41aB", chains: "Base" };
const moved = { name: "alice.bnb", confirmed: "0x71C7…976F" };

/**
 * Every other form of the bridge and send notices of spec 4, sections 4 and 4.4, beside the one
 * the notice table sends: a late bridge that arrived at a base58 address, which the engine names
 * whole; each reason a confirmed bridge lapsed unsigned; the rescue address joining bridge rules
 * now; each reason it stays out of them; and a send's name that now points nowhere or to the same
 * address of another kind. Keyed by the notice's key and the form it takes.
 */
export const transferNoticeVariants: Readonly<Record<string, TableNotice>> = {
  "notice.bridgeArrived base58": {
    key: "notice.bridgeArrived",
    values: { chain: "Solana", recipient: base58Recipient },
    amounts: { received },
  },
  "notice.bridgeLapsed rescue": {
    key: "notice.bridgeLapsed",
    values: { chain: "Base", why: "rescue" },
  },
  "notice.bridgeLapsed policy": {
    key: "notice.bridgeLapsed",
    values: { chain: "Base", why: "policy" },
  },
  "notice.bridgeLapsed other": {
    key: "notice.bridgeLapsed",
    values: { chain: "Base", why: "other" },
  },
  "notice.rescueBridged now": {
    key: "notice.rescueBridged",
    values: { ...rescue, chains: "Base, Arbitrum", status: "now" },
    times: { when: noticeTableAtMs },
  },
  "notice.rescueNotBridged kind": {
    key: "notice.rescueNotBridged",
    values: { ...rescue, chains: "Solana", why: "kind" },
  },
  "notice.rescueNotBridged room": {
    key: "notice.rescueNotBridged",
    values: { ...rescue, why: "room" },
  },
  "notice.rescueNotBridged other": {
    key: "notice.rescueNotBridged",
    values: { ...rescue, why: "other" },
  },
  "notice.nameMoved none": {
    key: "notice.nameMoved",
    values: { ...moved, now: "none" },
  },
  "notice.nameMoved sameAddress": {
    key: "notice.nameMoved",
    values: { ...moved, now: "sameAddress" },
  },
};
