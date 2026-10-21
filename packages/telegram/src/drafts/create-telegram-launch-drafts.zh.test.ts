import { idSchema } from "@binference/core";
import { describe, expect, it } from "vitest";
import {
  closedDraft,
  draftRef,
  live,
  openedDraft,
  pressOf,
  setUpDrafts,
} from "../testing/draft-fixtures.js";

const refused = String.fromCodePoint(0x274c);
const done = String.fromCodePoint(0x2705);

describe("the agent's launch drafts in Telegram, in Chinese", () => {
  it("sends the draft's header, buttons and end in the owner's language", async () => {
    const context = await setUpDrafts("zh");
    await context.drafts.show(openedDraft, live);
    const [message] = context.botApi.messages();
    const lines = message?.text.split("\n");
    expect([lines?.at(0), lines?.at(-1), message?.buttons]).toStrictEqual([
      "main 起草了这次代币发射。在你点按“开始发射”之前，不会上传或公开任何内容。",
      "点按“开始发射”后，发射确认卡片会显示发射手续费、新代币和首笔买入的最少所得，你在卡片上确认。此草稿在 08:10:00 失效。",
      [
        [
          { text: "开始发射", data: `bnf1:s:y:${draftRef}` },
          { text: "放弃", data: `bnf1:s:n:${draftRef}` },
        ],
      ],
    ]);
  });

  it("answers a Start and tells how the draft ended in Chinese", async () => {
    const context = await setUpDrafts("zh");
    await context.drafts.show(openedDraft, live);
    await context.drafts.press(pressOf(context, `bnf1:s:y:${draftRef}`), live);
    await context.drafts.show(closedDraft("expired"), live);
    expect([context.botApi.answers()[0]?.text, context.botApi.messages()[0]?.text]).toStrictEqual([
      "正在开始发射，草稿消息会显示进展。",
      `${refused} 此发射草稿已在 10 分钟后失效，没有上传任何内容。如需发射，请让 Agent 重新起草。`,
    ]);
  });

  it("says in Chinese why a launch ended before its card", async () => {
    const context = await setUpDrafts("zh");
    await context.drafts.show(openedDraft, live);
    const intent = "int_0190f1c2-3a4b-7c5d-8e6f-000000000285";
    await context.drafts.show(closedDraft("failed", { intent, reason: "per_trade_cap" }), live);
    expect(context.botApi.messages()[0]?.text).toBe(
      `${refused} 发射在确认卡片之前已结束：超过了你的单笔上限。没有签名任何交易。`,
    );
  });

  it("answers in Chinese a press on a draft the engine no longer holds", async () => {
    const context = await setUpDrafts("zh");
    await context.drafts.show(openedDraft, live);
    await context.drafts.press(pressOf(context, "bnf1:s:n:AAAAAAAAAAAAAAAA"), live);
    expect([context.botApi.answers()[0]?.text, context.botApi.messages()[0]?.text]).toStrictEqual([
      "binference 已不再保留此草稿。请让 Agent 重新起草。",
      `${refused} binference 已不再保留此发射草稿（重启后或已有较新的草稿）。请让 Agent 重新起草。`,
    ]);
  });

  it("says in Chinese that a forgotten draft already started its launch", async () => {
    const context = await setUpDrafts("zh");
    await context.drafts.show(openedDraft, live);
    const intent = idSchema("int").parse("int_0190f1c2-3a4b-7c5d-8e6f-000000000288");
    context.answers.launched("BBBBBBBBBBBBBBBB", { status: "launched", intent });
    await context.drafts.press(pressOf(context, "bnf1:s:y:BBBBBBBBBBBBBBBB"), live);
    expect([context.botApi.answers()[0]?.text, context.botApi.messages()[0]?.text]).toStrictEqual([
      "此草稿已开始发射，请查看其确认卡片了解进展。",
      `${done} 此草稿已开始发射，本对话中的确认卡片会显示其进展。此草稿不会再开始新的发射。`,
    ]);
  });
});
