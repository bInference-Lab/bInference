import { describe, expect, it } from "vitest";
import { ownerId } from "../testing/update-fixtures.js";
import { sentNoticeTable } from "./notice-table-fixtures.js";
import { signerNoticeVariants } from "./signer-notice-variants.js";

const warning = String.fromCodePoint(0x26a0, 0xfe0f);
const refused = `${warning} 一笔交易的一个步骤被拒绝签名：`;
const nothingSent = "该步骤未发送任何内容。";

describe("every form a signer service's refusal takes, in Chinese", () => {
  it("sends each to the owner's chat as the spec words it", async () => {
    const sent = await sentNoticeTable("zh", signerNoticeVariants);
    expect(sent.chats).toStrictEqual([ownerId]);
    expect(sent.texts).toStrictEqual({
      "notice.signerRefused unknown_wallet": `${refused}它来自签名服务无法识别的钱包。${nothingSent}`,
      "notice.signerRefused intent_state": `${refused}这笔交易已不在执行中。${nothingSent}`,
      "notice.signerRefused no_authorization": `${refused}它背后没有任何确认或授权。${nothingSent}`,
      "notice.signerRefused authorization_ended": `${refused}签名之前，背后的确认或授权已经过期。${nothingSent}`,
      "notice.signerRefused terms_changed": `${refused}它的条件与确认时的不同。${nothingSent}`,
      "notice.signerRefused nonce_held": `${refused}同一钱包的另一笔交易仍占用它的随机数，请在那笔交易结束后重新发起。${nothingSent}`,
      "notice.signerRefused privy_refused": `${refused}Privy 拒绝了它：钱包的上限不允许，或 bInference 的签名服务已从钱包中移除。请在 binference.io 上检查该钱包。${nothingSent}`,
    });
  });
});
