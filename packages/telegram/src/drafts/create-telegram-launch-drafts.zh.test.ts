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
      "发射已开始，确认卡片随后发送。",
      `${refused} 此发射草稿已在 10 分钟后失效，没有上传任何内容。如需发射，请让 Agent 重新起草。`,
    ]);
  });
});
