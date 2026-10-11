import { launchTicketHash } from "@binference/engine/access";
import { describe, expect, it } from "vitest";
import type { FakeMessage } from "../testing/fake-chat.js";
import { ownerId } from "../testing/update-fixtures.js";
import { startCommandBot } from "./test-command-bot.js";

const live = { signal: new AbortController().signal };

// The ticket in the fragment of a message's Mini App button; empty when it has none.
function ticketIn(messages: readonly FakeMessage[], index: number): string {
  const address = messages[index]?.buttons[0]?.[0]?.webApp ?? "https://x.invalid/";
  return new URLSearchParams(new URL(address).hash.slice(1)).get("ticket") ?? "";
}

const miniAppUrl = "https://owner.example.ts.net/mini";
const howToSet =
  "The console opens inside Telegram only from an HTTPS address, and binference has none yet. " +
  "Publish binference's port over HTTPS, for example with Tailscale serve, then set " +
  "remote.publicUrl in config.json5 to that address, such as " +
  "https://my-machine.my-tailnet.ts.net, and restart binference.";

describe("the /console command", () => {
  it("sends a button that opens the Mini App at its HTTPS address with a new ticket", async () => {
    const bot = await startCommandBot({}, { miniAppUrl });
    await bot.send("/console");
    const ticket = ticketIn(bot.botApi.messages(), 0);
    expect(bot.botApi.messages().map(({ text, buttons }) => ({ text, buttons }))).toStrictEqual([
      {
        text: "Tap the button to open the console inside Telegram.",
        buttons: [[{ text: "Open the console", webApp: `${miniAppUrl}#ticket=${ticket}` }]],
      },
    ]);
    expect(ticket).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const kept = {
      ticketHash: launchTicketHash(ticket),
      userId: ownerId,
      issuedAtMs: 1_760_000_000_000,
      expiresAtMs: 1_760_000_300_000,
    };
    await expect(bot.access.addLaunchTicket(kept, live)).resolves.toStrictEqual({
      ok: false,
      error: "exists",
    });
  });

  it("makes a new ticket for each /console", async () => {
    const bot = await startCommandBot({}, { miniAppUrl });
    await bot.send("/console");
    await bot.send("/console");
    const messages = bot.botApi.messages();
    expect(ticketIn(messages, 1)).not.toBe(ticketIn(messages, 0));
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
