import { describe, expect, it } from "vitest";
import { testToken } from "../intents/test-intents.js";
import { aliceEngine, testRevoke, testSend, transferCard } from "./test-transfers.js";

const warning = `${String.fromCodePoint(0x26a0)}${String.fromCodePoint(0xfe0f)}`;

describe("a send's and a revoke's card in Chinese", () => {
  it("shows a send by name with its address, its read, a smart account and another reverse name", async () => {
    const lines = await transferCard(await aliceEngine(), testSend({ name: "alice.bnb" }), "zh");
    expect(lines.slice(1, 5)).toStrictEqual([
      "向 alice.bnb（0x000000f1）转账 0.001 FAKE",
      "alice.bnb 指向 0x000000f1，读取于 08:00:00；签名前 binference 会再次读取",
      "alice.bnb 是智能账户钱包",
      `${warning} 此地址的反向记录指向 mallory.bnb，而不是 alice.bnb`,
    ]);
  });

  it("shows a revoke's spender and token", async () => {
    const lines = await transferCard(await aliceEngine(), testRevoke(testToken), "zh");
    expect(lines[1]).toBe("撤销 0x0000000b 对 TKN 的授权");
  });
});
