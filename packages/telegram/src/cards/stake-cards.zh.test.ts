import { describe, expect, it } from "vitest";
import { claimFacts, stakeFacts, unstakeFacts } from "../testing/stake-card-fixtures.js";
import { showTransferCard } from "../testing/transfer-card-bench.js";

const waiting = String.fromCodePoint(0x1f7e1);
const live = String.fromCodePoint(0x1f534);
const header = (kind: string) => `${waiting} 确认${kind} · main · ${live} 实盘`;
const validator = "Legend（0x71C7…976F）";
const reason = "Agent 说明  “Earn on idle BNB”";
const expiry = "过期时间 14:32:05";

describe("staking cards in the owner's chat, in Chinese", () => {
  it("shows a stake with its validator, commission and yearly rate", async () => {
    expect((await showTransferCard("zh", stakeFacts)).lines).toStrictEqual([
      header("质押"),
      `向 ${validator} 质押 2 BNB`,
      `验证者 ${validator} · 佣金 7.00%`,
      "年化收益率 3.50%，按其最近一天的收益计算",
      reason,
      expiry,
    ]);
  });

  it("shows an unstake with when its coin can be claimed, and not sooner", async () => {
    const lines = (await showTransferCard("zh", unstakeFacts)).lines;
    expect(lines.slice(0, 4)).toStrictEqual([
      header("解除质押"),
      `从 ${validator} 解除质押 2 BNB · 7 天后可领取`,
      `验证者 ${validator} · 佣金 7.00%`,
      "年化收益率 3.50%，按其最近一天的收益计算",
    ]);
    expect(lines[4]).toMatch(/^解绑期内锁定：.+ 起可领取，约 7 天后，在此之前无法取回$/u);
  });

  it("cuts a validator's long name to 32 characters", async () => {
    const lines = (await showTransferCard("zh", claimFacts)).lines;
    expect(lines[1]).toBe("从 A validator whose moniker is fa…（0x71C7…976F） 领取 2 BNB");
  });
});
