import { describe, expect, it } from "vitest";
import { expectOk } from "../intents/test-intents.js";
import { testCardText } from "../money-path/test-launches.js";
import { testCall } from "../operations/test-engine.js";
import { bridgeEngine, testBridge } from "./test-bridges.js";

describe("a bridge's card in Chinese", () => {
  it("names the payee, the least it receives there, the fees and the read", async () => {
    const { test } = await bridgeEngine();
    const view = expectOk(
      await test.engine.handlers["intent/propose"](testCall(testBridge({ rescue: true }))),
    );

    expect((await testCardText(test, view, "zh")).slice(1, 5)).toStrictEqual([
      "跨链 100 TKN 到 Fake Two · 收款地址 你的紧急转出地址（0x000000d9） · 约 1 分钟",
      "你的紧急转出地址（0x000000d9） 在 Fake Two 至少收到 99 TKN",
      "跨链费用 1 TKN · 通过 fake-cross",
      "binference 会读取 Fake Two 确认到账，延迟时会通知你",
    ]);
  });
});
