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
const validator = "Legend（0x71C7…976F）";

describe("the receipt of a staking move a venue refused, in Chinese (decision 0327)", () => {
  it.each([
    ["validator_jailed", `验证者 ${validator} 已被监禁，不会产生收益`],
    ["validator_unknown", `该平台没有验证者 ${validator}；请从其列表中选择`],
    ["nothing_staked", `该钱包未向 ${validator} 质押任何金额`],
    ["exceeds_staked", `超过了该钱包向 ${validator} 质押的价值；请全部解除质押，或减少金额`],
    ["below_min_stake", "该平台最少需要 1 BNB"],
    ["staking_paused", "该平台已暂停，现在不接受质押、解除质押或领取；请稍后再试"],
    ["wallet_blocked", "该平台拒绝此钱包；请从其他钱包质押"],
    [
      "claim_unpayable",
      "该平台支付领取款项的方式无法被此钱包的代码接收，领取会失败；请从没有代码的钱包领取",
    ],
    [
      "stake_over_ceiling",
      `该钱包的上限仍将单次质押限制在此数以下，因此未质押；请用你的所有者密钥重新写入上限，即 \`binference ceiling set --wallet ${stakeWalletId} --venues VENUES\`，列出 \`binference ceiling --wallet ${stakeWalletId}\` 显示的每个平台，然后再质押，或减少金额`,
    ],
    ["decode_mismatch", "构建的交易与你确认的内容不符，因此未签名"],
  ] as const)("names what %s names", (reason, words) => {
    expect(stakeReceiptText(reason, "zh")).toBe(`${refused} 未发送：${words}`);
  });

  it("names when the next part is ready", () => {
    expect(stakeReceiptText("nothing_to_claim", "zh")).toBe(
      `${refused} 未发送：还没有可领取的金额；下一笔将于 2026年10月13日 14:31:05 可领取`,
    );
  });

  it("names a validator the venue knows no name for by its address alone", () => {
    expect(stakeReceiptText("validator_jailed", "zh", unnamedStakeRefusalValues)).toBe(
      `${refused} 未发送：验证者 0x71C7…976F 已被监禁，不会产生收益`,
    );
  });

  it("names no next part when none waits to be ready", () => {
    expect(stakeReceiptText("nothing_to_claim", "zh", unnamedStakeRefusalValues)).toBe(
      `${refused} 未发送：还没有可领取的金额`,
    );
  });

  it("says what a landed unstake took out, and when a claim can take it", () => {
    expect(unstakedReceiptText("zh")).toBe(
      `${done} 已解除质押 2 BNB：2026年10月13日 14:31:05 起可领取 · 交易 0xcdcd…cdcd`,
    );
  });

  it("turns a landed unstake's card into its receipt, with its explorer link", async () => {
    await expect(settleTransferCard("zh", unstakeFacts, unstakedOutcome)).resolves.toBe(
      `${done} 已解除质押 2 BNB：2026年10月13日 14:31:05 起可领取 · https://bscscan.com/tx/${receiptTxHash}`,
    );
  });
});
