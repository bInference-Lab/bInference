import { describe, expect, it } from "vitest";
import {
  proposeIntent,
  testCardText,
  testLaunchEngine,
  testSettledLaunch,
} from "./test-launches.js";

describe("a token launch's card in Chinese", () => {
  it("shows every setting of the launch in Chinese", async () => {
    const { test } = await testLaunchEngine();
    const lines = await testCardText(test, await proposeIntent(test, testSettledLaunch), "zh");
    expect(lines.slice(1, 12)).toStrictEqual([
      "在 fake-curve 发射 MCAT（Moon Cat），与 FAKE 配对交易 · 首笔买入 0.000000000001 FAKE",
      "新代币 MCAT（0x000000e1）",
      "首笔买入至少获得 0.00000000097 MCAT（0x000000e1）",
      "发射手续费 0.000000000000002 FAKE",
      "简介：A cat on the moon",
      "网站：https://moon.example",
      "X：https://x.com/mooncat",
      expect.stringMatching(
        /^已发送图片：PNG，1 KB，SHA-256 [0-9a-f]{16} · 元数据位于 ipfs:\/\/fake-1$/,
      ),
      "每笔交易的交易税：3.00%",
      "回购并销毁：开启",
      "⚠️ 图片和文字已在 fake-curve 的存储中公开，即使取消也会保持公开",
    ]);
  });
});
