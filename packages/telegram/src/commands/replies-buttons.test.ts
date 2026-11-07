import { ok } from "@binference/core";
import type { OwnerChatHandlers } from "@binference/engine/surfaces";
import type { ArgsOf } from "@binference/protocol";
import { describe, expect, it } from "vitest";
import type { ReplySettings } from "../chat/chat-replies.js";
import { ownerId } from "../testing/update-fixtures.js";
import { startCommandBot } from "./test-command-bot.js";

// An engine whose `config/change` takes every change it is asked for, and the settings it holds.
function settingsKeeper(start: ReplySettings) {
  const patches: ArgsOf<"config/change">["patch"][] = [];
  const held = { settings: start };
  const handlers: OwnerChatHandlers = {
    "config/change": async ({ args }) => {
      patches.push(args.patch);
      return Promise.resolve(ok({ config: {}, restartNeeded: false }));
    },
  };
  return { handlers, patches, replies: () => held.settings };
}

async function shownReplies(start: ReplySettings = { stream: "progress" }) {
  const keeper = settingsKeeper(start);
  const bot = await startCommandBot(keeper.handlers, { replies: keeper.replies });
  await bot.send("/replies");
  const [message] = bot.botApi.messages();
  const press = async (data: string): Promise<void> =>
    bot.receive(bot.botApi.press({ from: ownerId, data, messageId: message?.messageId ?? 0 }));
  return { bot, keeper, press };
}

describe("the /replies command", () => {
  it("names how replies and reasoning show, and offers each choice, the one in use marked", async () => {
    const { bot } = await shownReplies({ stream: "partial", reasoning: "kept" });
    expect(bot.botApi.messages()).toMatchObject([
      {
        text:
          "In this chat the agent grows its answer in one message, and its reasoning is kept " +
          "before each answer. Tap to change; it applies from the next answer.",
        buttons: [
          [
            { text: "Status message", data: "bnf1:r:m:progress" },
            { text: "Growing answer (now)", data: "bnf1:r:m:partial" },
          ],
          [
            { text: "Hide reasoning", data: "bnf1:r:t:off" },
            { text: "Show reasoning", data: "bnf1:r:t:streamed" },
            { text: "Keep reasoning (now)", data: "bnf1:r:t:kept" },
          ],
        ],
      },
    ]);
  });

  it("sets one reply setting through the config change and marks the new choice", async () => {
    const { bot, keeper, press } = await shownReplies();
    await press("bnf1:r:t:streamed");
    expect(keeper.patches).toStrictEqual([{ telegram: { replies: { reasoning: "streamed" } } }]);
    expect(bot.botApi.messages()[0]?.text).toContain("its reasoning is shown while it works");
    expect(bot.botApi.answers().map((answer) => answer.text)).toStrictEqual([
      "Saved. It applies from the next answer.",
    ]);
  });

  it("changes nothing for the choice in use, and ignores data no button carries", async () => {
    const { bot, keeper, press } = await shownReplies();
    await press("bnf1:r:m:progress");
    await press("bnf1:r:t:loud");
    expect(keeper.patches).toStrictEqual([]);
    expect(bot.botApi.answers()).toHaveLength(1);
  });
});
