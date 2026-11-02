import { describe, expect, it } from "vitest";
import { receiptTxHash } from "../testing/card-fixtures.js";
import {
  stakeReceiptText,
  stakeWalletId,
  unnamedStakeRefusalValues,
  unstakedOutcome,
  unstakedReceiptText,
  unstakeFacts,
} from "../testing/stake-card-fixtures.js";
import { settleTransferCard } from "../testing/transfer-card-bench.js";

const refused = String.fromCodePoint(0x274c);
const done = String.fromCodePoint(0x2705);
const validator = "Legend (0x71C7…976F)";

describe("the receipt of a staking move a venue refused, in the owner's chat (decision 0327)", () => {
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
    [
      "stake_over_ceiling",
      `this wallet's ceiling still holds one stake to less than this, so nothing was staked; write it again with your owner key, \`binference ceiling set --wallet ${stakeWalletId}\`, then stake again, or stake less`,
    ],
    [
      "decode_mismatch",
      "the built transaction did not match what you confirmed, so it was not signed",
    ],
  ] as const)("names what %s names", (reason, words) => {
    expect(stakeReceiptText(reason, "en")).toBe(`${refused} Not sent: ${words}`);
  });

  it("names a validator the venue knows no name for by its address alone", () => {
    expect(stakeReceiptText("validator_jailed", "en", unnamedStakeRefusalValues)).toBe(
      `${refused} Not sent: the validator 0x71C7…976F is jailed, so it earns nothing`,
    );
  });

  it("names no next part when none waits to be ready", () => {
    expect(stakeReceiptText("nothing_to_claim", "en", unnamedStakeRefusalValues)).toBe(
      `${refused} Not sent: nothing is ready to claim yet`,
    );
  });

  it("says what a landed unstake took out, and when a claim can take it", () => {
    expect(unstakedReceiptText("en")).toBe(
      `${done} Unstaked 2 BNB: claim it from Oct 13, 2026, 14:31:05 · transaction 0xcdcd…cdcd`,
    );
  });

  it("turns a landed unstake's card into its receipt, with its explorer link", async () => {
    await expect(settleTransferCard("en", unstakeFacts, unstakedOutcome)).resolves.toBe(
      `${done} Unstaked 2 BNB: claim it from Oct 13, 2026, 14:31:05 · https://bscscan.com/tx/${receiptTxHash}`,
    );
  });
});
