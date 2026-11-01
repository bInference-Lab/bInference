import { describe, expect, it } from "vitest";
import { base58Recipient } from "../testing/transfer-card-fixtures.js";
import { ownerId } from "../testing/update-fixtures.js";
import { sentNoticeTable } from "./notice-table-fixtures.js";
import { transferNoticeVariants } from "./transfer-notice-variants.js";

const done = String.fromCodePoint(0x2705);
const warning = String.fromCodePoint(0x26a0, 0xfe0f);
const lapsed = `${warning} 你到 Base 的跨链在确认过期前未发送：`;
const notPaid = (chains: string) =>
  `main 的钱包不会跨链到你在 ${chains} 上的紧急转出地址 0x9F3c…41aB：`;
const sendTo = `${warning} 向 alice.bnb 的转账未签名：`;
const sendAgain = "。未发送任何内容。请检查域名，然后重新发起转账。";

// Every other form of the bridge and send notices, as the owner reads it in Chinese.
const expected: Readonly<Record<string, string>> = {
  "notice.bridgeArrived base58": `${done} 你延迟的跨链已在 Solana 到账：${base58Recipient} 收到 19.96 FAKE`,
  "notice.bridgeLapsed rescue": `${lapsed}你的紧急转出地址自卡片后已更改或出现合约代码，请检查后重新发起。未签名任何内容。`,
  "notice.bridgeLapsed policy": `${lapsed}你的限额或地址簿已不再允许它，请检查后重新发起。未签名任何内容。`,
  "notice.bridgeLapsed other": `${lapsed}binference 无法再次检查它，请重新发起。未签名任何内容。`,
  "notice.rescueBridged now":
    "main 的钱包现在可以跨链到你在 Base, Arbitrum 上的紧急转出地址 0x9F3c…41aB：它在那里和在本链上都没有合约代码，因此很可能是同一把密钥持有的普通钱包。",
  "notice.rescueNotBridged kind": `${notPaid("Solana")}跨链从不付款到地址类型不同的链上的紧急转出地址。要跨链到那里，请用你的所有者密钥在地址簿中保存一个你在 Solana 上控制的地址。`,
  "notice.rescueNotBridged room": `${notPaid("Base")}上限在那里列出的地址已达上限。要腾出位置，请删除一个为 Base 保存的地址；binference 会在下次修改上限时加入紧急转出地址。`,
  "notice.rescueNotBridged other": `${notPaid("Base")}binference 无法读取它在那里的合约代码。binference 会在下次修改上限时重新读取。`,
  "notice.nameMoved none": `${sendTo}该域名现在未指向任何地址${sendAgain}`,
  "notice.nameMoved sameAddress": `${sendTo}该域名仍指向 0x71C7…976F，但该地址的类型自卡片后已改变${sendAgain}`,
};

describe("every other form of the bridge and send notices, in Chinese", () => {
  it("sends each form to the owner's chat as the spec words it", async () => {
    const sent = await sentNoticeTable("zh", transferNoticeVariants);
    expect(sent.chats).toStrictEqual([ownerId]);
    expect(sent.texts).toStrictEqual(expected);
  });
});
