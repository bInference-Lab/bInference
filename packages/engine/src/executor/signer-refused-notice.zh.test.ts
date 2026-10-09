import { createFormatter } from "@binference/i18n";
import { describe, expect, it } from "vitest";
import { signerRefusedNoticeKey } from "./signer-refused-notice.js";

const warning = String.fromCodePoint(0x26a0, 0xfe0f);

describe("the signer refusal notice in Chinese", () => {
  it("names the broken rule in plain words", () => {
    const chinese = createFormatter({ locale: "zh", timeZone: "UTC" });
    expect(chinese.message(signerRefusedNoticeKey, { rule: "rule_3" })).toBe(
      `${warning} 签名进程拒绝为一笔交易的一个步骤签名：金额与这笔交易不符。该步骤未发送任何内容。`,
    );
  });
});
