import { describe, expect, it } from "vitest";
import { expectOk, testAgent } from "../intents/test-intents.js";
import { testCardText } from "../money-path/test-launches.js";
import { testCall } from "../operations/test-engine.js";
import { startIdentityEngine, testRegistry } from "./test-identities.js";

const warning = `${String.fromCodePoint(0x26a0)}${String.fromCodePoint(0xfe0f)}`;

describe("an identity registration's card in Chinese", () => {
  it("shows every field of its file and that the record is public for good", async () => {
    const test = await startIdentityEngine(testRegistry());
    const view = expectOk(
      await test.engine.handlers["identity/register"](testCall({ agent: testAgent })),
    );
    const lines = await testCardText(test, view, "zh");
    expect(lines).toContain(
      "永久公开在链上：名称 main，简介 无，账户 fake:1:0x0000000c，binference 2026.11.3",
    );
    expect(lines).toContain(
      "同样公开：binference 页面 https://example.org/binference，Agent 标记为活跃，且没有其他登记或信任模型",
    );
    expect(lines).toContain(`${warning} 任何人都可以把此账户与此 Agent 关联，且该记录无法删除`);
  });
});
