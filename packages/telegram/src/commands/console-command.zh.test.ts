import { describe, expect, it } from "vitest";
import { startCommandBot } from "./test-command-bot.js";

const miniAppUrl = "https://owner.example.ts.net/mini";
const ticketAddress = /^https:\/\/owner\.example\.ts\.net\/mini#ticket=[\w-]{43}$/;

describe("the /console command in Chinese", () => {
  it("sends the button in the owner's language", async () => {
    const bot = await startCommandBot({}, { locale: "zh", miniAppUrl });
    await bot.send("/console");
    const messages = bot.botApi.messages();
    expect(messages.map(({ text }) => text)).toStrictEqual([
      "点击按钮，在 Telegram 中打开控制台。",
    ]);
    const buttons = messages.flatMap((message) => message.buttons.flat());
    expect(buttons.map((button) => button.text)).toStrictEqual(["打开控制台"]);
    expect(buttons[0]?.webApp).toMatch(ticketAddress);
  });

  it("says how to set the address without one", async () => {
    const bot = await startCommandBot({}, { locale: "zh" });
    await bot.send("/console");
    expect(bot.texts()).toStrictEqual([
      "控制台只能从 HTTPS 地址在 Telegram 中打开，而 binference 还没有这样的地址。请先通过 HTTPS 发布 binference 的端口，例如使用 Tailscale serve，然后在 config.json5 中把 remote.publicUrl 设为该地址，例如 https://my-machine.my-tailnet.ts.net，再重启 binference。",
    ]);
  });
});
