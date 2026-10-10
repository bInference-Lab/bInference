import { createFormatter } from "@binference/i18n";
import { describe, expect, it } from "vitest";
import { signerRevokedKey } from "./signer-revoked-notice.js";

const chinese = createFormatter({ locale: "zh", timeZone: "UTC" });

describe("the signer revoked notice in Chinese", () => {
  it("names the signer and the surface in the glossary's words", () => {
    expect(chinese.message(signerRevokedKey, { signer: "quorum-1", surface: "cli" })).toBe(
      "⚠️ 已从 命令行 用所有者密钥从所有钱包移除签名方 quorum-1 的 Agent 密钥。持有它的机器无法再签名。不是你操作？请立即冻结。",
    );
  });
});
