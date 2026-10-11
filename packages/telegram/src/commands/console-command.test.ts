import { describe, expect, it } from "vitest";
import { startCommandBot } from "./test-command-bot.js";

const miniAppUrl = "https://owner.example.ts.net/mini";
const howToSet =
  "The console opens inside Telegram only from an HTTPS address, and binference has none yet. " +
  "Publish binference's port over HTTPS, for example with Tailscale serve, then set " +
  "remote.publicUrl in config.json5 to that address, such as " +
  "https://my-machine.my-tailnet.ts.net, and restart binference.";

describe("the /console command", () => {
  it("sends a button that opens the Mini App at its HTTPS address", async () => {
    const bot = await startCommandBot({}, { miniAppUrl });
    await bot.send("/console");
    expect(bot.botApi.messages().map(({ text, buttons }) => ({ text, buttons }))).toStrictEqual([
      {
        text: "Tap the button to open the console inside Telegram.",
        buttons: [[{ text: "Open the console", webApp: miniAppUrl }]],
      },
    ]);
  });

  it.each([
    { name: "no address", options: {} },
    { name: "an http address", options: { miniAppUrl: "http://127.0.0.1:7456/mini" } },
    { name: "an address with a password", options: { miniAppUrl: "https://a:b@x.ts.net/mini" } },
    { name: "text that is no address", options: { miniAppUrl: "owner.example.ts.net" } },
  ])("says how to set the address and sends no button with $name", async ({ options }) => {
    const bot = await startCommandBot({}, options);
    await bot.send("/console");
    expect(bot.botApi.messages().map(({ text, buttons }) => ({ text, buttons }))).toStrictEqual([
      { text: howToSet, buttons: [] },
    ]);
  });
});
