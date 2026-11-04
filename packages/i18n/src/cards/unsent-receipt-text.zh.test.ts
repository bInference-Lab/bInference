import { accountRefSchema, assetRefSchema } from "@binference/chain";
import { describe, expect, it } from "vitest";
import { createFormatter } from "../format/create-formatter.js";
import { unsentReceiptText } from "./unsent-receipt-text.js";

const chinese = createFormatter({ locale: "zh", timeZone: "UTC" });
const refused = String.fromCodePoint(0x274c);

describe("the receipt of an intent that ended before it sent or filled, in Chinese", () => {
  it("names why, or says it ended unsigned", () => {
    expect([
      unsentReceiptText(chinese, "nothing_to_sell"),
      unsentReceiptText(chinese, undefined),
    ]).toStrictEqual([
      `${refused} 未发送：钱包中这种代币不足`,
      `${refused} 未发送：在签名之前已结束`,
    ]);
  });

  it("names a bridge's chain in the words of its reason", () => {
    expect(unsentReceiptText(chinese, "bridge_chain_unpaid", { chain: "Solana" })).toBe(
      `${refused} 未发送：binference 使用的跨链服务目前都无法从此钱包向 Solana 上的地址付款，因此未发送任何内容；请跨链到另一条链`,
    );
  });
});

const coin = assetRefSchema.parse("eip155:56/slip44:714");
const stakeWallet = "wal_0190f1c2-3a4b-7c5d-8e6f-000000000001";
// A staking move's view as the engine draws one that ended with a venue's refusal.
const stakeNames = {
  wallet: stakeWallet,
  validator: {
    account: accountRefSchema.parse("eip155:56:0x71C7656EC7ab88b098defB751B7401B5f6d8976F"),
    name: "Legend",
  },
  minStake: { asset: coin, base: 10n ** 18n },
  readyAt: Date.UTC(2026, 10, 9, 14, 31, 5),
  assets: { [coin]: { symbol: "BNB", name: "BNB", decimals: 18, verified: true } },
} as const;
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
      `该钱包的上限仍将单次质押限制在此数以下，因此未质押；请用你的所有者密钥重新写入上限，即 \`binference ceiling set --wallet ${stakeWallet} --venues VENUES\`，列出 \`binference ceiling --wallet ${stakeWallet}\` 显示的每个平台，然后再质押，或减少金额`,
    ],
  ])("names what %s names", (reason, words) => {
    expect(unsentReceiptText(chinese, reason, stakeNames)).toBe(`${refused} 未发送：${words}`);
  });

  it("names when the next part is ready, or nothing when none waits", () => {
    const { readyAt: _readyAt, ...none } = stakeNames;
    expect([
      unsentReceiptText(chinese, "nothing_to_claim", stakeNames),
      unsentReceiptText(chinese, "nothing_to_claim", none),
    ]).toStrictEqual([
      expect.stringMatching(
        new RegExp(`^${refused} 未发送：还没有可领取的金额；下一笔将于 .+ 可领取$`, "u"),
      ),
      `${refused} 未发送：还没有可领取的金额`,
    ]);
  });
});
