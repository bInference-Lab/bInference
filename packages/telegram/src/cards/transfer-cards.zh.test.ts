import { messages } from "@binference/i18n";
import { describe, expect, it } from "vitest";
import { showTransferCard, type TransferPress } from "../testing/transfer-card-bench.js";
import {
  base58Recipient,
  baseBridgeFacts,
  checksummedRecipient,
  nameSendFacts,
  rescueSendFacts,
  revokeFacts,
  savedSendFacts,
  solanaBridgeFacts,
} from "../testing/transfer-card-fixtures.js";

const waiting = String.fromCodePoint(0x1f7e1);
const live = String.fromCodePoint(0x1f534);
const warning = String.fromCodePoint(0x26a0, 0xfe0f);
const header = (kind: string) => `${waiting} 确认${kind} · main · ${live} 实盘`;
const expiry = "过期时间 14:32:05";
const maxAnswerLength = 200;

describe("send, revoke and bridge cards in the owner's chat, in Chinese", () => {
  it("shows a bridge to a base58 address with every line a bridge has", async () => {
    const payee = `Cold wallet（${base58Recipient}）`;
    expect((await showTransferCard("zh", solanaBridgeFacts)).lines).toStrictEqual([
      header("跨链"),
      `跨链 20 USDT 到 Solana · 收款地址 ${payee} · 约 2 分钟`,
      `${payee} 在 Solana 至少收到 19.91 USDC`,
      "跨链费用 0.06 USDT · 通过 Relay",
      "兑换汇率：0.15%",
      "binference 会读取 Solana 确认到账，延迟时会通知你",
      "Solana 地址没有校验码：请逐字核对",
      "从你的跨链钱包 Bridge 发起",
      `${warning} USDT 在 Solana 以另一种代币 USDC 到账`,
      "Agent 说明  “Moving profits to my Solana wallet”",
      expiry,
    ]);
  });

  it("shows a bridge to the rescue address whole and checksummed, in the token it sends", async () => {
    const payee = `你的紧急转出地址（${checksummedRecipient}）`;
    expect((await showTransferCard("zh", baseBridgeFacts)).lines).toStrictEqual([
      header("跨链"),
      `跨链 20 USDT 到 Base · 收款地址 ${payee} · 约 1 分钟`,
      `${payee} 在 Base 至少收到 19.97 USDT`,
      "跨链费用 0.03 USDT · 通过 Across",
      "binference 会读取 Base 确认到账，延迟时会通知你",
      "Agent 说明  “Rescue the profits to Base”",
      expiry,
    ]);
  });

  it("shows a send by name with the address it points to, its read and its warnings", async () => {
    expect((await showTransferCard("zh", nameSendFacts)).lines).toStrictEqual([
      header("转账"),
      `向 alice.bnb（${checksummedRecipient}）转账 1 USDT`,
      `alice.bnb 指向 ${checksummedRecipient}，读取于 14:31:05；签名前 binference 会再次读取`,
      "alice.bnb 是智能账户钱包",
      `${warning} 你从未向此地址转账`,
      `${warning} 此地址的反向记录指向 bob.bnb，而不是 alice.bnb`,
      "Agent 说明  “Paying Alice as you asked”",
      expiry,
    ]);
  });

  it.each([
    ["a saved address by its label", savedSendFacts, `Savings（${checksummedRecipient}）`],
    ["the rescue address", rescueSendFacts, `你的紧急转出地址（${checksummedRecipient}）`],
  ])("shows a send to %s, its address whole", async (_name, facts, recipient) => {
    expect((await showTransferCard("zh", facts)).lines.slice(0, 2)).toStrictEqual([
      header("转账"),
      `向 ${recipient} 转账 1 USDT`,
    ]);
  });

  it("shows a revoke with its spender's registry name before its short address", async () => {
    expect((await showTransferCard("zh", revokeFacts)).lines.slice(0, 2)).toStrictEqual([
      header("撤销授权"),
      "撤销 PancakeSwap v2 router（0x71C7…976F） 对 USDT 的授权",
    ]);
  });

  it("answers a Confirm that closes a bridge card with no words, only ending the spinner", async () => {
    expect((await showTransferCard("zh", solanaBridgeFacts, "confirmed")).answer).toBeUndefined();
  });

  it.each<[TransferPress, string]>([
    ["locked", "error.engine.locked"],
    ["over_cap", "error.limit.daily_cap"],
  ])(
    "answers a %s press of a bridge to a base58 address within 200 characters",
    async (press, key) => {
      const { answer } = await showTransferCard("zh", solanaBridgeFacts, press);
      expect(answer).toBe(messages.zh[key]);
      expect(String(answer).length).toBeLessThanOrEqual(maxAnswerLength);
    },
  );
});
