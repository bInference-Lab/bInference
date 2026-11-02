import { accountRefSchema, assetRefSchema } from "@binference/chain";
import { protocolIdSchema } from "@binference/protocol";
import { describe, expect, it } from "vitest";
import { createFormatter } from "../format/create-formatter.js";
import { reasonNamesOf, unsentReceiptText } from "./unsent-receipt-text.js";

const english = createFormatter({ locale: "en", timeZone: "UTC" });
const refused = String.fromCodePoint(0x274c);

describe("the receipt of an intent that ended before it sent or filled", () => {
  it("names why, as Telegram's copy of the card does", () => {
    expect(unsentReceiptText(english, "nothing_to_sell")).toBe(
      `${refused} Not sent: the wallet holds too little of this token`,
    );
  });

  it("names a send by name's name in the words of its reason", () => {
    expect(unsentReceiptText(english, "name_moved", { name: "alice.bnb" })).toBe(
      `${refused} Not sent: alice.bnb changed since the card: it points elsewhere, to nothing, or its address changed kind; check the name, then propose the send again`,
    );
  });

  it("names a bridge's chain and never tells the owner to save a rescue address with code", () => {
    const wallet = protocolIdSchema("wallet").parse("wal_0190f1c2-3a4b-7c5d-8e6f-000000000001");
    const view = { wallet, outcome: { reason: "rescue_not_plain", chain: "Base" }, assets: {} };
    const text = unsentReceiptText(english, "rescue_not_plain", reasonNamesOf(view));
    expect(text).toBe(
      `${refused} Not sent: your rescue address holds code on Base or on this wallet's chain, so the same address on Base may not be yours and nothing was sent; save an address you control on Base in the address book with your owner key, then bridge to that entry`,
    );
  });

  it("names the wallet whose ceiling a bridge needs written again", () => {
    const named = { chain: "Base", wallet: "wal_1" };
    expect(unsentReceiptText(english, "ceiling_lacks_payee", named)).toContain(
      "`binference ceiling set --wallet wal_1`",
    );
  });

  it("says it ended unsigned for no reason, or one this version has no words for", () => {
    const unsent = `${refused} Not sent: it ended before it was signed`;
    expect([
      unsentReceiptText(english, undefined),
      unsentReceiptText(english, "a_code_from_a_newer_engine"),
    ]).toStrictEqual([unsent, unsent]);
  });
});

const coin = assetRefSchema.parse("eip155:56/slip44:714");
const stakeWallet = protocolIdSchema("wallet").parse("wal_0190f1c2-3a4b-7c5d-8e6f-000000000001");
// A staking move's view as the engine draws one that ended with a venue's refusal.
const stakeView = {
  wallet: stakeWallet,
  outcome: {
    validator: {
      account: accountRefSchema.parse("eip155:56:0x71C7656EC7ab88b098defB751B7401B5f6d8976F"),
      name: "Legend",
    },
    minStake: { asset: coin, base: 10n ** 18n },
    readyAt: Date.UTC(2026, 10, 9, 14, 31, 5),
  },
  assets: { [coin]: { symbol: "BNB", name: "BNB", decimals: 18, verified: true } },
} as const;
const validator = "Legend (0x71C7…976F)";

describe("the receipt of a staking move a venue refused (decision 0327)", () => {
  it.each([
    ["validator_jailed", `the validator ${validator} is jailed, so it earns nothing`],
    ["validator_unknown", `the venue lists no validator ${validator}; pick one from its list`],
    ["nothing_staked", `this wallet has nothing staked with ${validator}`],
    [
      "exceeds_staked",
      `that is more than this wallet's stake with ${validator} is worth; unstake all of it, or less`,
    ],
    ["below_min_stake", "the venue takes at least 1 BNB"],
    [
      "nothing_to_claim",
      "nothing is ready to claim yet; the next part is ready at Nov 9, 2026, 14:31:05",
    ],
    [
      "staking_paused",
      "the venue is paused and takes no stake, unstake or claim now; try again later",
    ],
    ["wallet_blocked", "the venue refuses this wallet; stake from another wallet"],
    [
      "claim_unpayable",
      "the venue pays a claim in a way this wallet's code cannot receive, so the claim would fail; claim from a wallet without code",
    ],
    [
      "stake_over_ceiling",
      `this wallet's ceiling still holds one stake to less than this, so nothing was staked; write it again with your owner key, \`binference ceiling set --wallet ${stakeWallet}\`, then stake again, or stake less`,
    ],
  ])("names what %s names", (reason, words) => {
    expect(unsentReceiptText(english, reason, reasonNamesOf(stakeView))).toBe(
      `${refused} Not sent: ${words}`,
    );
  });

  it("names the validator by its address alone before the venue named it", () => {
    const named = { validator: { account: stakeView.outcome.validator.account } };
    expect(unsentReceiptText(english, "validator_unknown", named)).toBe(
      `${refused} Not sent: the venue lists no validator 0x71C7…976F; pick one from its list`,
    );
  });

  it("says nothing is ready, and no time, when no part waits", () => {
    expect(unsentReceiptText(english, "nothing_to_claim", {})).toBe(
      `${refused} Not sent: nothing is ready to claim yet`,
    );
  });
});
