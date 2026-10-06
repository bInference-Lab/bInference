import { Api } from "grammy";
import { describe, expect, it } from "vitest";
import { createFakeBotApi, fakeBotToken } from "../testing/fake-bot-api.js";
import { botApiFault } from "./bot-api-error.schema.js";

async function failedCall(refusal: Parameters<ReturnType<typeof createFakeBotApi>["failNext"]>[1]) {
  const botApi = createFakeBotApi();
  botApi.failNext("sendMessage", refusal);
  const api = new Api(fakeBotToken, { fetch: botApi.fetch });
  const error: unknown = await api
    .sendMessage(1, "private chat text")
    .catch((caught: unknown) => caught);
  return botApiFault(error, "sendMessage");
}

describe("botApiFault", () => {
  it.each([
    [401, "telegram.bad_token", false],
    [404, "telegram.bad_token", false],
    [409, "telegram.poll_conflict", false],
    [403, "telegram.api_refused", false],
    [502, "telegram.api_refused", true],
  ] as const)("maps a %i answer to %s", async (status, code, retryable) => {
    const fault = await failedCall({ status, description: "refused" });
    expect(fault).toMatchObject({ code, retryable, details: { method: "sendMessage", status } });
  });

  it("maps a flood to the wait Telegram asks for", async () => {
    const fault = await failedCall({
      status: 429,
      description: "Too Many Requests",
      retryAfterS: 7,
    });
    expect(fault).toMatchObject({
      code: "telegram.flood",
      retryable: true,
      details: { retryAfterMs: 7000 },
    });
  });

  it("maps a network failure without the token or the text in any part of the fault", async () => {
    const fault = await failedCall("network");
    expect(fault).toMatchObject({ code: "telegram.unreachable", retryable: true });
    expect(fault.cause).toBeUndefined();
    const everything = JSON.stringify({
      fault,
      text: String(fault),
      stack: fault.stack,
      details: fault.details,
    });
    expect(everything).not.toContain(fakeBotToken);
    expect(everything).not.toContain("private chat text");
  });

  it("maps any other error to a failed call that is not retried", () => {
    expect(botApiFault(new TypeError("boom"), "getUpdates")).toMatchObject({
      code: "telegram.api_failed",
      retryable: false,
    });
  });
});
