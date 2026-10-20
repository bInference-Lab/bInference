import { assetRefSchema } from "@binference/chain";
import { bpsSchema } from "@binference/core";
import { createFormatter } from "@binference/i18n";
import { describe, expect, it } from "vitest";
import { riskDocument } from "../intents/intent-documents.schema.js";
import { testAgent, testCoin, testToken } from "../intents/test-intents.js";
import { testChains } from "../operations/test-engine.js";
import { noticeText } from "../surfaces/notice-text.js";
import {
  copyGraceMs,
  copyStartOf,
  copyStateDocument,
  type CopyTaking,
  takenState,
} from "./copy-state.js";
import { fillNotice, skippedNotice } from "./fill-notices.js";
import { testLeaderTx } from "./test-copies.js";
import { testCopy, testLeader } from "./test-orders.js";

const chains = testChains();
const english = { formatter: createFormatter({ locale: "en", timeZone: "UTC" }), chains };
const unlisted = assetRefSchema.parse("fake:1/token:0x0000000f");
const book = [{ account: testLeader, label: "Whale" }];

// The icons of spec 4, built from their code points: no emoji sits in code.
const warning = String.fromCodePoint(0x26a0, 0xfe0f);
const done = String.fromCodePoint(0x2705);
const paper = String.fromCodePoint(0x1f9ea);

// A copy order that took `taking`.
function copying(taking: Omit<CopyTaking, "take">) {
  const triggerState = copyStateDocument.encode(takenState(copyStartOf(0), taking));
  return {
    agentId: testAgent,
    kind: "copy",
    isPaper: true,
    request: testCopy(),
    triggerState,
  } as const;
}

const honeyBuy = copying({
  id: 3,
  txHash: testLeaderTx,
  side: "buy",
  asset: unlisted,
  atMs: 0,
  facts: { symbol: "HONEY", name: "Honey", decimals: 18, verified: false },
});
const tokenSale = copying({
  id: 4,
  txHash: testLeaderTx,
  side: "sell",
  asset: testToken,
  atMs: 0,
  shareSoldBps: bpsSchema.parse(4_000),
  facts: { symbol: "TKN", name: "Test token", decimals: 6, verified: true },
});
const sold = {
  amountIn: { asset: testToken, base: 2_000_000n },
  amountOut: { asset: testCoin, base: 10n ** 15n },
  atMs: 1,
  soldPrice: { numerator: 4n, denominator: 5n },
};

describe("a copy order's notices in English", () => {
  it("carry the risk check's warning on a copy buy, and no line on a pass", () => {
    const warned = { verdict: "warn", flags: [{ code: "high_tax", source: "measured" }] } as const;
    const risk = riskDocument.encode({ ...warned, onCurve: false, checkedAt: 0 });
    const passed = riskDocument.encode({
      verdict: "pass",
      flags: [],
      onCurve: false,
      checkedAt: 0,
    });
    const soldPrice = { numerator: 2n, denominator: 10n ** 9n };
    const amountOut = { asset: unlisted, base: 10n ** 18n };
    const bought = { ...sold, amountIn: sold.amountOut, amountOut, soldPrice };
    const skip = skippedNotice(honeyBuy, { reason: "no_route", risk });
    const fill = fillNotice(honeyBuy, bought, { decimals: 18, assets: {}, book, risk });
    const clean = fillNotice(honeyBuy, bought, { decimals: 18, assets: {}, book, risk: passed });

    expect(noticeText(skip, english)).toBe(
      `${warning} Copy trade of 0x00000009's buy of HONEY 0x0000000f skipped: no route was found for this trade. The order stays active.\n${warning} The risk check warned about this token (high_tax); the order's caps bound what a copy can lose.`,
    );
    expect(noticeText(fill, english)).toBe(
      `${paper} ${done} Copy trade filled: copied Whale: bought 1 HONEY (0x0000000f) for $2.00\n${warning} The risk check warned about this token (high_tax); the order's caps bound what a copy can lose.`,
    );
    expect(noticeText(clean, english)).toBe(
      `${paper} ${done} Copy trade filled: copied Whale: bought 1 HONEY (0x0000000f) for $2.00`,
    );
  });

  it("name the leader's trade and its token in a skip, the leader by label when saved", () => {
    const notice = skippedNotice(honeyBuy, { reason: "honeypot" });
    const labelled = skippedNotice(tokenSale, { reason: "nothing_to_sell", book });

    expect(noticeText(notice, english)).toBe(
      `${warning} Copy trade of 0x00000009's buy of HONEY 0x0000000f skipped: the token looks like a honeypot: you might not be able to sell it. The order stays active.`,
    );
    expect(noticeText(labelled, english)).toBe(
      `${warning} Copy trade of Whale's sale of TKN skipped: the wallet holds too little of this token. The order stays active.`,
    );
  });

  it("tell a copied sale with the leader's share", () => {
    const notice = fillNotice(tokenSale, sold, { decimals: 6, assets: {}, book });

    expect(noticeText(notice, english)).toBe(
      `${paper} ${done} Copy trade filled: copied Whale selling 40.00%: sold 2 TKN for $1.60`,
    );
  });

  it("tell a copied sale made past its minute as late, with when the leader sold", () => {
    const late = { ...sold, atMs: copyGraceMs + 1 };
    const notice = fillNotice(tokenSale, late, { decimals: 6, assets: {}, book });
    const when = english.formatter.dateTime(0);

    expect(noticeText(notice, english)).toBe(
      `${paper} ${done} Copy trade filled: copied Whale selling 40.00% at ${when}, late, at the price now: sold 2 TKN for $1.60`,
    );
  });
});
