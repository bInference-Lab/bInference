import { ok } from "@binference/core";
import type { OwnerChatHandlers } from "@binference/engine/surfaces";
import { describe, expect, it } from "vitest";
import { startCommandBot } from "./test-command-bot.js";

const handlers: OwnerChatHandlers = {
  "config/change": async () => Promise.resolve(ok({ config: {}, restartNeeded: false })),
};

const replies = () => ({ stream: "progress", reasoning: "streamed" }) as const;

describe("the /replies command in Chinese", () => {
  it("names how replies and reasoning show, in Chinese, with Chinese buttons", async () => {
    const bot = await startCommandBot(handlers, { locale: "zh", replies });
    await bot.send("/replies");
    expect(bot.botApi.messages()).toMatchObject([
      {
        text: "在此对话中，Agent 工作时显示一条状态消息，然后发送回答，推理在工作时显示。点按即可更改，从下一个回答起生效。",
        buttons: [
          [{ text: "状态消息（当前）" }, { text: "逐步生成回答" }],
          [{ text: "隐藏推理" }, { text: "实时显示推理（当前）" }, { text: "保留推理" }],
        ],
      },
    ]);
  });
});
