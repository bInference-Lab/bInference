import { err, ok } from "@binference/core";
import type { OwnerChatHandlers } from "@binference/engine/surfaces";
import type { ArgsOf } from "@binference/protocol";
import { describe, expect, it } from "vitest";
import { ownerId } from "../testing/update-fixtures.js";
import { startCommandBot } from "./test-command-bot.js";

const han = /\p{Script=Han}/u;

/** An engine whose `config/change` takes every change it is asked for, or refuses them all. */
function configKeeper(refusal?: "config.invalid") {
  const patches: ArgsOf<"config/change">["patch"][] = [];
  const handlers: OwnerChatHandlers = {
    "config/change": async ({ args }) => {
      patches.push(args.patch);
      return Promise.resolve(
        refusal === undefined ? ok({ config: {}, restartNeeded: false }) : err(refusal),
      );
    },
  };
  return { handlers, patches };
}

async function shownLanguages(refusal?: "config.invalid") {
  const keeper = configKeeper(refusal);
  const bot = await startCommandBot(keeper.handlers);
  await bot.send("/lang");
  const [message] = bot.botApi.messages();
  const press = async (data: string): Promise<void> =>
    bot.receive(bot.botApi.press({ from: ownerId, data, messageId: message?.messageId ?? 0 }));
  return { bot, keeper, press };
}

describe("the /lang buttons", () => {
  it("set the owner's language through the config change and answer in it", async () => {
    const { bot, keeper, press } = await shownLanguages();
    await press("bnf1:l:s:zh");
    expect(keeper.patches).toStrictEqual([{ owner: { locale: "zh" } }]);
    const texts = [...bot.botApi.messages(), ...bot.botApi.answers()].map(({ text }) => text);
    expect(texts.map((text) => han.test(String(text)))).toStrictEqual([true, true]);
  });

  it("change nothing for the language in use, and say so", async () => {
    const { bot, keeper, press } = await shownLanguages();
    await press("bnf1:l:s:en");
    expect(keeper.patches).toStrictEqual([]);
    expect(bot.botApi.answers().map((answer) => answer.text)).toStrictEqual([
      "binference uses English with you now.",
    ]);
  });

  it("say a refusal in the chat and stop the button's spinner", async () => {
    const { bot, press } = await shownLanguages("config.invalid");
    await press("bnf1:l:s:zh");
    expect(bot.texts().at(-1)).toBe(
      "The config has an error. Run `binference check` to see where and how to fix it.",
    );
    expect(bot.botApi.answers().map((answer) => answer.text)).toStrictEqual([undefined]);
  });

  it("do nothing for a language binference does not speak", async () => {
    const { bot, keeper, press } = await shownLanguages();
    await press("bnf1:l:s:fr");
    expect([keeper.patches, bot.botApi.answers()]).toStrictEqual([[], []]);
  });
});
