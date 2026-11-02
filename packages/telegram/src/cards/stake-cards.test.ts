import type { QuoteFailure } from "@binference/engine";
import { messages } from "@binference/i18n";
import { describe, expect, it } from "vitest";
import {
  askedUnstakeFacts,
  claimFacts,
  liquidClaimFacts,
  liquidStakeFacts,
  liquidStakeRefusalValues,
  liquidUnstakeFacts,
  longStakeRefusalValues,
  stakeFacts,
  stakeWalletId,
  unnamedStakeFacts,
  unstakeFacts,
} from "../testing/stake-card-fixtures.js";
import { showTransferCard, type TransferPress } from "../testing/transfer-card-bench.js";

const waiting = String.fromCodePoint(0x1f7e1);
const live = String.fromCodePoint(0x1f534);
const header = (kind: string) => `${waiting} Confirm ${kind} · main · ${live} Live`;
const validator = "Legend (0x71C7…976F)";
const longValidator = "A validator whose moniker is fa… (0x71C7…976F)";
const reason = 'Agent says  "Earn on idle BNB"';
const expiry = "Expires at 14:32:05";

// Telegram's most characters in the answer to a press (Bot API `answerCallbackQuery`).
const maxAnswerLength = 200;

describe("staking cards in the owner's chat, in English", () => {
  it("shows a stake with its validator, commission, yearly rate and the days an unstake waits", async () => {
    expect((await showTransferCard("en", stakeFacts)).lines).toStrictEqual([
      header("stake"),
      `Stake 2 BNB with ${validator}`,
      `Validator ${validator} · commission 7.00%`,
      "Yearly rate 3.50%, from its last day of rewards",
      "Unstaking later takes 7 days before you can claim it",
      reason,
      expiry,
    ]);
  });

  it("names an unnamed validator by its address, leaves out a missing rate and says one day", async () => {
    expect((await showTransferCard("en", unnamedStakeFacts)).lines).toStrictEqual([
      header("stake"),
      "Stake 1 BNB with 0x71C7…976F",
      "Validator 0x71C7…976F · commission 7.00%",
      "Unstaking later takes 1 day before you can claim it",
      reason,
      expiry,
    ]);
  });

  it("shows an unstake with when its coin can be claimed, and not sooner", async () => {
    expect((await showTransferCard("en", unstakeFacts)).lines).toStrictEqual([
      header("unstake"),
      `Unstake 2 BNB from ${validator} · ready in 7 days`,
      `Validator ${validator} · commission 7.00%`,
      "Locked while it unbonds: you can claim it from Oct 13, 2026, 14:31:05, in about 7 days, and not sooner",
      reason,
      expiry,
    ]);
  });

  it("shows an unstake auto mode asked about, ready in one day, its validator's markup as text", async () => {
    const named = "<b>Legend</b>\\u{202E} (0x71C7…976F)";
    expect((await showTransferCard("en", askedUnstakeFacts)).lines).toStrictEqual([
      header("unstake"),
      `Unstake 1 BNB from ${named} · ready in 1 day`,
      `Validator ${named} · commission 7.00%`,
      "Locked while it unbonds: you can claim it from Oct 7, 2026, 14:31:05, in about 1 day, and not sooner",
      "Auto mode asks you here: an unstake locks the funds while they unbond",
      reason,
      expiry,
    ]);
  });

  it("shows a claim, its validator's long name cut to 32 characters", async () => {
    expect((await showTransferCard("en", claimFacts)).lines).toStrictEqual([
      header("claim"),
      `Claim 2 BNB from ${longValidator}`,
      `Validator ${longValidator} · commission 7.00%`,
      reason,
      expiry,
    ]);
  });
});

describe("the answer to a press of a staking card, in English", () => {
  it.each<[TransferPress, string]>([
    ["locked", "error.engine.locked"],
    ["over_cap", "error.limit.daily_cap"],
  ])("answers a %s press of a stake within 200 characters", async (press, key) => {
    const { answer } = await showTransferCard("en", stakeFacts, press);
    expect(answer).toBe(messages.en[key]);
    expect(String(answer).length).toBeLessThanOrEqual(maxAnswerLength);
  });

  it.each<[QuoteFailure, string]>([
    ["validator_unknown", `the venue lists no validator ${longValidator}; pick one from its list`],
    ["nothing_staked", `this wallet has nothing staked with ${longValidator}`],
    [
      "exceeds_staked",
      `that is more than this wallet's stake with ${longValidator} is worth; unstake all of it, or less`,
    ],
    [
      "nothing_to_claim",
      "nothing is ready to claim yet; the next part is ready at Oct 13, 2026, 14:31:05",
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
  ])("answers a press a venue refused with %s whole", async (refusal, words) => {
    const press = { reason: refusal, values: longStakeRefusalValues } as const;
    const { answer } = await showTransferCard("en", unstakeFacts, press);
    expect(answer).toBe(words);
    expect(String(answer).length).toBeLessThanOrEqual(maxAnswerLength);
  });

  it("cuts the ceiling refusal to 200 characters after its whole command", async () => {
    const press = { reason: "stake_over_ceiling", values: longStakeRefusalValues } as const;
    const { answer } = await showTransferCard("en", stakeFacts, press);
    expect(answer).toBe(
      `this wallet's ceiling still holds one stake to less than this, so nothing was staked; write it again with your owner key, \`binference ceiling set --wallet ${stakeWalletId}\`, t…`,
    );
    expect(answer).toHaveLength(maxAnswerLength);
  });
});

describe("a liquid venue's staking cards in the owner's chat, in English (decision 0331)", () => {
  it("shows a stake, an unstake and a claim by the venue's name, with no validator line", async () => {
    const shown = await Promise.all(
      [liquidStakeFacts, liquidUnstakeFacts, liquidClaimFacts].map(async (facts) =>
        showTransferCard("en", facts),
      ),
    );
    expect(shown.map(({ lines }) => lines)).toStrictEqual([
      [
        header("stake"),
        "Stake 1 BNB with Lista for at least 0.961 slisBNB",
        "Unstaking later takes 7 days before you can claim it",
        reason,
        expiry,
      ],
      [
        header("unstake"),
        "Unstake 0.961 slisBNB from Lista",
        "Locked while it unbonds: you can claim it from Oct 13, 2026, 14:31:05, in about 7 days, and not sooner",
        "Lista's own queue releases it and may take longer; binference tells you once you can claim it",
        reason,
        expiry,
      ],
      [header("claim"), "Claim 1 BNB from your Lista unstake", reason, expiry],
    ]);
  });

  it.each<[QuoteFailure, string]>([
    ["nothing_staked", "this wallet has nothing staked with Lista (0x1adB…7fE6)"],
    [
      "exceeds_staked",
      "that is more than this wallet's stake with Lista (0x1adB…7fE6) is worth; unstake all of it, or less",
    ],
    [
      "nothing_to_claim",
      "nothing is ready to claim yet; the next part is ready at Oct 13, 2026, 14:31:05",
    ],
  ])("answers a press of an unstake Lista refused with %s whole", async (refusal, words) => {
    const press = { reason: refusal, values: liquidStakeRefusalValues } as const;
    const { answer } = await showTransferCard("en", liquidUnstakeFacts, press);
    expect(answer).toBe(words);
    expect(String(answer).length).toBeLessThanOrEqual(maxAnswerLength);
  });

  it("cuts Lista's ceiling refusal to 200 characters after its whole command", async () => {
    const press = { reason: "stake_over_ceiling", values: liquidStakeRefusalValues } as const;
    const { answer } = await showTransferCard("en", liquidStakeFacts, press);
    expect(answer).toContain(`\`binference ceiling set --wallet ${stakeWalletId}\``);
    expect(String(answer).length).toBeLessThanOrEqual(maxAnswerLength);
  });
});
