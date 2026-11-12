import { fakeBotToken } from "@binference/telegram/testing";
import { describe, expect, it, vi } from "vitest";
import { createSmokeBot } from "./smoke-bot.js";

const pollUrl = `https://api.telegram.org/bot${fakeBotToken}/getUpdates`;
const minute = 60_000;

describe("the smoke's synthetic Bot API", () => {
  it("hears a long poll for updates while the fake still holds it", async () => {
    const bot = createSmokeBot();
    const stop = new AbortController();
    const poll = bot.http.request({
      method: "POST",
      url: pollUrl,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ timeout: 30 }),
      signal: stop.signal,
    });
    const polls = (api: typeof bot.api) =>
      api.calls().some(({ method }) => method === "getUpdates");
    // The fake holds the poll until an update comes, so only hearing it as it waits passes.
    const outcome = bot.until("poll for updates", polls, minute).then(
      () => "heard",
      () => "timed out",
    );
    await vi.advanceTimersByTimeAsync(minute);
    await expect(outcome).resolves.toBe("heard");
    stop.abort();
    await expect(poll).rejects.toThrow("aborted");
  });
});
