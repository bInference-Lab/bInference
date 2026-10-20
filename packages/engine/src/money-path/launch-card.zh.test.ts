import { describe, expect, it } from "vitest";
import {
  proposeIntent,
  testCardText,
  testLaunch,
  testLaunchEngine,
  testSettledLaunch,
} from "./test-launches.js";

describe("a token launch's card in Chinese", () => {
  it("shows the launchpad's own warning in Chinese", async () => {
    const { test } = await testLaunchEngine({ cardWarnings: ["notForUsCitizens"] });
    const lines = await testCardText(test, await proposeIntent(test, testLaunch), "zh");
    expect(lines).toContain("⚠️ Brew 的网站称其不向美国公民提供服务");
  });

  it("shows a picture written into the create call with its size", async () => {
    const { test } = await testLaunchEngine({ writesPicture: { mostBytes: 1_000 } });
    const view = await proposeIntent(test, { ...testLaunch, image: "upl_sized" });
    expect(await testCardText(test, view, "zh")).toContainEqual(
      expect.stringMatching(
        /^随代币写入链上的图片：PNG，29 字节，64 x 48 像素，SHA-256 [0-9a-f]{16}$/,
      ),
    );
  });

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

  it("warns when the create call carries no minimum for the first buy", async () => {
    const { test } = await testLaunchEngine({ noFirstBuyMin: true });
    const lines = await testCardText(test, await proposeIntent(test, testSettledLaunch), "zh");
    expect(lines).toContain(
      "⚠️ 首笔买入在链上没有最低数量：它在创建代币的同一笔调用中执行，早于任何其他交易，模拟结果至少为上面的数量",
    );
    const bound = await testLaunchEngine();
    const boundLines = await testCardText(bound.test, await proposeIntent(bound.test), "zh");
    expect(boundLines).not.toContain(
      "⚠️ 首笔买入在链上没有最低数量：它在创建代币的同一笔调用中执行，早于任何其他交易，模拟结果至少为上面的数量",
    );
  });

  it("shows a picture link whole, with no picture sent and nothing public", async () => {
    const { test } = await testLaunchEngine({ takesPictureLink: true });
    const pictureLink = "https://pictures.example/cat.png";
    const request = { ...testLaunch, image: "none", venueOptions: { taxBps: 300, pictureLink } };
    const lines = await testCardText(test, await proposeIntent(test, request), "zh");
    expect(lines).toContain("图片地址 https://pictures.example/cat.png（binference 从不打开它）");
    expect(lines.some((line) => line.startsWith("已发送图片"))).toBe(false);
    expect(lines.some((line) => line.includes("即使取消也会保持公开"))).toBe(false);
  });
});
