import { accountRefSchema, assetRefSchema, chainRefSchema } from "@binference/chain";
import { type PortfolioView, protocolIdSchema } from "@binference/protocol";
import { describe, expect, it } from "vitest";
import { createFormatter } from "../format/create-formatter.js";
import { cardLineText } from "./card-text.js";
import { stakeLines, transitLine } from "./held-elsewhere-lines.js";

const wallet = protocolIdSchema("wallet").parse("wal_0190f1c2-3a4b-7c5d-8e6f-000000000001");
const coin = assetRefSchema.parse("fake:1/slip44:1");
const receipt = assetRefSchema.parse("fake:1/erc20:0x00000000000000000000000000000000000000cc");
const validator = accountRefSchema.parse("fake:1:0x2222222222222222222222222222222222220001");
const unit = 10n ** 18n;
const atMs = Date.UTC(2026, 10, 3, 12);

const view: PortfolioView = {
  balances: [
    { wallet, amount: { asset: receipt, base: unit }, usdMicros: 630_000_000n, paper: false },
  ],
  positions: [],
  totalUsdMicros: 630_000_000n,
  assets: {
    [coin]: { symbol: "BNB", name: "BNB", decimals: 18, verified: true },
    [receipt]: { symbol: "stBNB", name: "Credit", decimals: 18, verified: true },
  },
};
const display = {
  formatter: createFormatter({ locale: "en", timeZone: "UTC" }),
  assets: view.assets,
};
const texts = (lines: ReturnType<typeof stakeLines>) =>
  lines.map((line) => cardLineText(line, display));

const stake = {
  wallet,
  venue: "stakehub",
  validator,
  staked: { asset: receipt, base: unit },
  stakedValue: { asset: coin, base: (unit * 105n) / 100n },
  unbonding: [{ amount: { asset: coin, base: unit / 2n }, readyAt: atMs }],
  claimable: { asset: coin, base: unit / 10n },
  paper: false,
};

describe("a stake's and a bridge's lines in a portfolio", () => {
  it("shows a stake's worth, each unbonding part with its time and what a claim takes", () => {
    expect(texts(stakeLines(view, stake))).toStrictEqual([
      "1.05 BNB staked with 0x2222…0001 · worth $630.00",
      "0.5 BNB unbonding, claimable from Nov 3, 2026, 12:00:00",
      "0.1 BNB ready to claim",
    ]);
  });

  it("names the venue for a pool, says a value is unknown, and leaves out empty parts", () => {
    const { validator: _left, ...pooled } = stake;
    const paper = { ...pooled, paper: true, unbonding: [], claimable: { asset: coin, base: 0n } };
    expect(texts(stakeLines(view, paper))).toStrictEqual([
      "1.05 BNB staked with stakehub · value unknown",
    ]);
    expect(
      texts(stakeLines(view, { ...paper, staked: { asset: receipt, base: 0n } })),
    ).toStrictEqual([]);
  });

  it("shows a bridge in transit with the chain named, and says when it is late", () => {
    const transit = {
      intent: protocolIdSchema("intent").parse("int_0190f1c2-3a4b-7c5d-8e6f-0000000000c1"),
      wallet,
      amount: { asset: coin, base: unit },
      toChain: chainRefSchema.parse("fake:2"),
      recipient: accountRefSchema.parse("fake:2:0x4444444444444444444444444444444444440001"),
      sentAt: atMs,
      late: true,
    };
    expect(cardLineText(transitLine(view, transit, "Base"), display)).toBe(
      "1 BNB to 0x4444…0001 on Base · since Nov 3, 2026, 12:00:00 · late",
    );
  });
});
