import type { SignerServiceRefusal } from "@binference/chain";
import { createFormatter } from "@binference/i18n";
import { describe, expect, it } from "vitest";
import { signerRefusedNoticeKey } from "./signer-refused-notice.js";

const warning = String.fromCodePoint(0x26a0, 0xfe0f);
const chinese = createFormatter({ locale: "zh", timeZone: "UTC" });
const refused = `${warning} 一笔交易的一个步骤被拒绝签名：`;
const nothingSent = "该步骤未发送任何内容。";

describe("the signer refusal notice in Chinese", () => {
  it("names the broken rule in plain words", () => {
    expect(chinese.message(signerRefusedNoticeKey, { rule: "rule_3" })).toBe(
      `${refused}金额与这笔交易不符。${nothingSent}`,
    );
  });

  it.each<readonly [SignerServiceRefusal, string]>([
    ["unknown_wallet", "它来自签名服务无法识别的钱包"],
    ["intent_state", "这笔交易已不在执行中"],
    ["no_authorization", "它背后没有任何确认或授权"],
    ["authorization_ended", "签名之前，背后的确认或授权已经过期"],
    ["terms_changed", "它的条件与确认时的不同"],
    ["nonce_held", "同一钱包的另一笔交易仍占用它的随机数，请在那笔交易结束后重新发起"],
    [
      "privy_refused",
      "Privy 拒绝了它：钱包的上限不允许，或 bInference 的签名服务已从钱包中移除。请在 binference.io 上检查该钱包",
    ],
  ])("says what a signer service's %s means", (reason, words) => {
    expect(chinese.message(signerRefusedNoticeKey, { rule: reason })).toBe(
      `${refused}${words}。${nothingSent}`,
    );
  });
});
