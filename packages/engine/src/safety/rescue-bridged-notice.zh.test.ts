import { describe, expect, it } from "vitest";
import { nextRescueThere, standing, standingWords } from "./test-rescue-notices.js";

const address = "0x000000d9";
const next = "0x000000d8";
const plain = "它在那里和在本链上都没有合约代码，因此很可能是同一把密钥持有的普通钱包。";

describe("the rescue address standings' notices in Chinese", () => {
  it("tells a waiting address's time, and later that bridges may now pay it", () => {
    const waiting = standing("waiting", nextRescueThere);
    expect(standingWords("zh", { before: [], after: [waiting] })).toStrictEqual([
      `你的新紧急转出地址 ${next} 于 2026年10月11日 09:30:00 生效后，main 的钱包可以跨链到它在 Fake Two 上的地址：${plain}`,
    ]);
    const joined = standing("joined", nextRescueThere);
    expect(standingWords("zh", { before: [waiting], after: [joined] })).toStrictEqual([
      `main 的钱包现在可以跨链到你在 Fake Two 上的紧急转出地址 ${next}：${plain}`,
    ]);
  });

  it("names the reason the address stays out, with its next step", () => {
    expect(standingWords("zh", { before: [], after: [standing("code")] })).toStrictEqual([
      `main 的钱包不会跨链到你在 Fake Two 上的紧急转出地址 ${address}：它在那里或在本链上有合约代码，因此那里的同一地址可能不属于你。要跨链到那里，请用你的所有者密钥在地址簿中保存一个你在 Fake Two 上控制的地址。`,
    ]);
    expect(standingWords("zh", { before: [], after: [standing("unread")] })).toStrictEqual([
      `main 的钱包不会跨链到你在 Fake Two 上的紧急转出地址 ${address}：binference 无法读取它在那里的合约代码。binference 会在下次修改上限时重新读取。`,
    ]);
  });
});
