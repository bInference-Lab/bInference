import { afterEach, describe, expect, it } from "vitest";
import { type ChatHarness, confirmedRow } from "./testing/chat-harness.js";

const refused = String.fromCodePoint(0x274c);
const coin = "eip155:56/slip44:714";
const chats: ChatHarness[] = [];

afterEach(async () => {
  for (const chat of chats.splice(0)) {
    chat.press("\u0003");
    // oxlint-disable-next-line eslint/no-await-in-loop -- each chat ends before the next test
    await chat.ended;
  }
});

// A staking move a venue refused after its card, as the engine's view names it.
function stakeRefused(reason: string) {
  return {
    state: "failed_check",
    wallet: "wal_0190f1c2-3a4b-7c5d-8e6f-000000000001",
    outcome: {
      reason,
      validator: {
        account: "eip155:56:0x71C7656EC7ab88b098defB751B7401B5f6d8976F",
        name: "Legend",
      },
      minStake: { asset: coin, base: "1000000000000000000" },
      readyAt: Date.UTC(2026, 10, 9, 14, 31, 5),
    },
    assets: { [coin]: { symbol: "BNB", name: "BNB", decimals: 18, verified: true } },
  };
}

const validator = "Legend (0x71C7…976F)";

describe("a confirmed staking card a venue refused (decision 0327)", () => {
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
    ["wallet_blocked", "the venue refuses this wallet; stake from another wallet"],
  ])("says why it was not sent, naming what %s names", async (reason, words) => {
    expect(await confirmedRow(chats, stakeRefused(reason))).toBe(`${refused} Not sent: ${words}`);
  });
});
