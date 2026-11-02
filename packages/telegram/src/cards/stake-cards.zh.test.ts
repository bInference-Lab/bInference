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
const header = (kind: string) => `${waiting} 确认${kind} · main · ${live} 实盘`;
const validator = "Legend（0x71C7…976F）";
const longValidator = "A validator whose moniker is fa…（0x71C7…976F）";
const reason = "Agent 说明  “Earn on idle BNB”";
const expiry = "过期时间 14:32:05";

// Telegram's most characters in the answer to a press (Bot API `answerCallbackQuery`).
const maxAnswerLength = 200;

describe("staking cards in the owner's chat, in Chinese", () => {
  it("shows a stake with its validator, commission, yearly rate and the days an unstake waits", async () => {
    expect((await showTransferCard("zh", stakeFacts)).lines).toStrictEqual([
      header("质押"),
      `向 ${validator} 质押 2 BNB`,
      `验证者 ${validator} · 佣金 7.00%`,
      "年化收益率 3.50%，按其最近一天的收益计算",
      "日后解除质押需等待 7 天才能领取",
      reason,
      expiry,
    ]);
  });

  it("names an unnamed validator by its address, leaves out a missing rate and says one day", async () => {
    expect((await showTransferCard("zh", unnamedStakeFacts)).lines).toStrictEqual([
      header("质押"),
      "向 0x71C7…976F 质押 1 BNB",
      "验证者 0x71C7…976F · 佣金 7.00%",
      "日后解除质押需等待 1 天才能领取",
      reason,
      expiry,
    ]);
  });

  it("shows an unstake with when its coin can be claimed, and not sooner", async () => {
    expect((await showTransferCard("zh", unstakeFacts)).lines).toStrictEqual([
      header("解除质押"),
      `从 ${validator} 解除质押 2 BNB · 7 天后可领取`,
      `验证者 ${validator} · 佣金 7.00%`,
      "解绑期内锁定：2026年10月13日 14:31:05 起可领取，约 7 天后，在此之前无法取回",
      reason,
      expiry,
    ]);
  });

  it("shows an unstake auto mode asked about, ready in one day, its validator's markup as text", async () => {
    const named = "<b>Legend</b>\\u{202E}（0x71C7…976F）";
    expect((await showTransferCard("zh", askedUnstakeFacts)).lines).toStrictEqual([
      header("解除质押"),
      `从 ${named} 解除质押 1 BNB · 1 天后可领取`,
      `验证者 ${named} · 佣金 7.00%`,
      "解绑期内锁定：2026年10月7日 14:31:05 起可领取，约 1 天后，在此之前无法取回",
      "自动模式在此需要你确认：解除质押后资金在解绑期内锁定",
      reason,
      expiry,
    ]);
  });

  it("shows a claim, its validator's long name cut to 32 characters", async () => {
    expect((await showTransferCard("zh", claimFacts)).lines).toStrictEqual([
      header("领取"),
      `从 ${longValidator} 领取 2 BNB`,
      `验证者 ${longValidator} · 佣金 7.00%`,
      reason,
      expiry,
    ]);
  });
});

describe("the answer to a press of a staking card, in Chinese", () => {
  it.each<[TransferPress, string]>([
    ["locked", "error.engine.locked"],
    ["over_cap", "error.limit.daily_cap"],
  ])("answers a %s press of a stake within 200 characters", async (press, key) => {
    const { answer } = await showTransferCard("zh", stakeFacts, press);
    expect(answer).toBe(messages.zh[key]);
    expect(String(answer).length).toBeLessThanOrEqual(maxAnswerLength);
  });

  it.each<[QuoteFailure, string]>([
    ["validator_unknown", `该平台没有验证者 ${longValidator}；请从其列表中选择`],
    ["nothing_staked", `该钱包未向 ${longValidator} 质押任何金额`],
    ["exceeds_staked", `超过了该钱包向 ${longValidator} 质押的价值；请全部解除质押，或减少金额`],
    ["nothing_to_claim", "还没有可领取的金额；下一笔将于 2026年10月13日 14:31:05 可领取"],
    ["staking_paused", "该平台已暂停，现在不接受质押、解除质押或领取；请稍后再试"],
    ["wallet_blocked", "该平台拒绝此钱包；请从其他钱包质押"],
    [
      "claim_unpayable",
      "该平台支付领取款项的方式无法被此钱包的代码接收，领取会失败；请从没有代码的钱包领取",
    ],
    [
      "stake_over_ceiling",
      `该钱包的上限仍将单次质押限制在此数以下，因此未质押；请用你的所有者密钥重新写入上限，即 \`binference ceiling set --wallet ${stakeWalletId}\`，然后再质押，或减少金额`,
    ],
  ])("answers a press a venue refused with %s whole", async (refusal, words) => {
    const press = { reason: refusal, values: longStakeRefusalValues } as const;
    const { answer } = await showTransferCard("zh", unstakeFacts, press);
    expect(answer).toBe(words);
    expect(String(answer).length).toBeLessThanOrEqual(maxAnswerLength);
  });
});

describe("a liquid venue's staking cards in the owner's chat, in Chinese (decision 0331)", () => {
  it("shows a stake, an unstake and a claim by the venue's name, with no validator line", async () => {
    const shown = await Promise.all(
      [liquidStakeFacts, liquidUnstakeFacts, liquidClaimFacts].map(async (facts) =>
        showTransferCard("zh", facts),
      ),
    );
    expect(shown.map(({ lines }) => lines)).toStrictEqual([
      [
        header("质押"),
        "在 Lista 质押 1 BNB，至少获得 0.961 slisBNB",
        "日后解除质押需等待 7 天才能领取",
        reason,
        expiry,
      ],
      [
        header("解除质押"),
        "从 Lista 解除质押 0.961 slisBNB",
        "解绑期内锁定：2026年10月13日 14:31:05 起可领取，约 7 天后，在此之前无法取回",
        "由 Lista 自己的队列放行，可能更久；可以领取时 binference 会通知你",
        reason,
        expiry,
      ],
      [header("领取"), "领取你在 Lista 解除质押的 1 BNB", reason, expiry],
    ]);
  });

  it.each<QuoteFailure>(["nothing_staked", "exceeds_staked", "nothing_to_claim"])(
    "answers a press of an unstake Lista refused with %s within 200 characters",
    async (refusal) => {
      const press = { reason: refusal, values: liquidStakeRefusalValues } as const;
      const { answer } = await showTransferCard("zh", liquidUnstakeFacts, press);
      expect(String(answer).length).toBeLessThanOrEqual(maxAnswerLength);
    },
  );

  it("keeps Lista's ceiling refusal within 200 characters with its whole command", async () => {
    const press = { reason: "stake_over_ceiling", values: liquidStakeRefusalValues } as const;
    const { answer } = await showTransferCard("zh", liquidStakeFacts, press);
    expect(answer).toContain(`\`binference ceiling set --wallet ${stakeWalletId}\``);
    expect(String(answer).length).toBeLessThanOrEqual(maxAnswerLength);
  });
});
