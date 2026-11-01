import { describe, expect, it } from "vitest";
import { claimFacts, stakeFacts, unstakeFacts } from "../testing/stake-card-fixtures.js";
import { showTransferCard } from "../testing/transfer-card-bench.js";

const waiting = String.fromCodePoint(0x1f7e1);
const live = String.fromCodePoint(0x1f534);
const header = (kind: string) => `${waiting} Confirm ${kind} · main · ${live} Live`;
const validator = "Legend (0x71C7…976F)";
const reason = 'Agent says  "Earn on idle BNB"';
const expiry = "Expires at 14:32:05";

describe("staking cards in the owner's chat, in English", () => {
  it("shows a stake with its validator, commission and yearly rate", async () => {
    expect((await showTransferCard("en", stakeFacts)).lines).toStrictEqual([
      header("stake"),
      `Stake 2 BNB with ${validator}`,
      `Validator ${validator} · commission 7.00%`,
      "Yearly rate 3.50%, from its last day of rewards",
      reason,
      expiry,
    ]);
  });

  it("shows an unstake with when its coin can be claimed, and not sooner", async () => {
    expect((await showTransferCard("en", unstakeFacts)).lines).toStrictEqual([
      header("unstake"),
      `Unstake 2 BNB from ${validator} · ready in 7 days`,
      `Validator ${validator} · commission 7.00%`,
      "Yearly rate 3.50%, from its last day of rewards",
      "Locked while it unbonds: you can claim it from Oct 13, 2026, 14:31:05, in about 7 days, and not sooner",
      reason,
      expiry,
    ]);
  });

  it("cuts a validator's long name to 32 characters", async () => {
    const lines = (await showTransferCard("en", claimFacts)).lines;
    expect(lines[1]).toBe("Claim 2 BNB from A validator whose moniker is fa… (0x71C7…976F)");
  });
});
