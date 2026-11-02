import { afterEach, describe, expect, it } from "vitest";
import {
  type ChatAnswers,
  type ChatHarness,
  confirmedRow,
  harnessAgent,
} from "./testing/chat-harness.js";

const order = "ord_0190f1c2-3a4b-7c5d-8e6f-000000000005";
const ctrlC = "\u0003";
const chats: ChatHarness[] = [];

afterEach(async () => {
  for (const chat of chats.splice(0)) {
    chat.press(ctrlC);
    // oxlint-disable-next-line eslint/no-await-in-loop -- each chat ends before the next test
    await chat.ended;
  }
});

// A Chinese chat with one card that waits, which a Confirm leaves as `confirmedAs`.
async function confirmedIn(confirmedAs: object, more: ChatAnswers = {}): Promise<string> {
  return confirmedRow(chats, confirmedAs, { locale: "zh", more });
}

describe("a confirmed card that sends nothing, in Chinese", () => {
  it("says the unfreeze took effect, for one agent or every agent", async () => {
    const one = await confirmedIn({
      state: "reconciled",
      request: { kind: "unfreeze", agent: harnessAgent },
    });
    const every = await confirmedIn({ state: "reconciled", request: { kind: "unfreeze" } });
    expect([one, every]).toStrictEqual([
      "已解除冻结。该 Agent 可以在交易限额内再次交易。",
      "已解除冻结。全部 Agent 可以在交易限额内再次交易，新建的 Agent 也不再冻结。",
    ]);
  });

  it("says a paper sale that could not fill was not sent, and why", async () => {
    const short = { state: "failed_check", outcome: { reason: "nothing_to_sell" } };
    expect(await confirmedIn(short)).toBe(
      `${String.fromCodePoint(0x274c)} 未发送：钱包中这种代币不足`,
    );
  });

  it("says whether the auto order became active", async () => {
    const confirmed = { state: "reconciled", request: { kind: "autoOrder", order } };
    const active = await confirmedIn(confirmed, { "order/get": () => ({ state: "active" }) });
    const expired = await confirmedIn(confirmed, { "order/get": () => ({ state: "expired" }) });
    expect([active, expired]).toStrictEqual([
      "已确认。自动订单已生效。",
      "已确认。自动订单未生效：确认之前它已过期。",
    ]);
  });
});

const coin = "eip155:56/slip44:714";

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

const validator = "Legend（0x71C7…976F）";

describe("a confirmed staking card a venue refused, in Chinese (decision 0327)", () => {
  it.each([
    ["validator_jailed", `验证者 ${validator} 已被监禁，不会产生收益`],
    ["validator_unknown", `该平台没有验证者 ${validator}；请从其列表中选择`],
    ["nothing_staked", `该钱包未向 ${validator} 质押任何金额`],
    ["exceeds_staked", `超过了该钱包向 ${validator} 质押的价值；请全部解除质押，或减少金额`],
    ["below_min_stake", "该平台最少需要 1 BNB"],
    ["wallet_blocked", "该平台拒绝此钱包；请从其他钱包质押"],
  ])("says why it was not sent, naming what %s names", async (reason, words) => {
    expect(await confirmedIn(stakeRefused(reason))).toBe(
      `${String.fromCodePoint(0x274c)} 未发送：${words}`,
    );
  });
});
