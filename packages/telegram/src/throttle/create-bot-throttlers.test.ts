import { createManualClock, createMemoryLogger } from "@binference/core/testing";
import { Api } from "grammy";
import { describe, expect, it } from "vitest";
import { createFakeBotApi, fakeBotToken } from "../testing/fake-bot-api.js";
import { ownerId } from "../testing/update-fixtures.js";
import { createBotThrottlers } from "./create-bot-throttlers.js";

const otherToken = "7012345679:AAE_anotherFakeTokenForTests_0123456789";

function setUp() {
  const botApi = createFakeBotApi();
  const clock = createManualClock(0);
  const throttlers = createBotThrottlers({
    clock,
    logger: createMemoryLogger({ subsystem: "telegram" }),
  });
  const arrivals: number[] = [];
  const apiFor = (token: string): Api =>
    new Api(token, {
      fetch: async (input: Parameters<typeof botApi.fetch>[0], init?: RequestInit) => {
        arrivals.push(clock.now());
        return botApi.fetch(input, init);
      },
    });
  return { botApi, clock, throttlers, arrivals, apiFor };
}

describe("the bot throttlers", () => {
  it("share one throttler among every Api of a bot token", async () => {
    const { clock, throttlers, arrivals, apiFor } = setUp();
    const ingressApi = apiFor(fakeBotToken);
    const cardsApi = apiFor(fakeBotToken);
    throttlers.install(ingressApi);
    throttlers.install(cardsApi);
    const calls = [ingressApi.sendMessage(ownerId, "one"), cardsApi.sendMessage(ownerId, "two")];
    await clock.advance(1_000);
    await Promise.all(calls);
    expect(arrivals).toStrictEqual([0, 1_000]);
  });

  it("give another bot token its own throttler", async () => {
    const { clock, throttlers, arrivals, apiFor } = setUp();
    const ours = apiFor(fakeBotToken);
    const other = apiFor(otherToken);
    throttlers.install(ours);
    throttlers.install(other);
    const refused = other.sendMessage(ownerId, "two").catch((error: unknown) => error);
    await ours.sendMessage(ownerId, "one");
    await clock.advance(0);
    expect(await refused).toMatchObject({ error_code: 401 });
    expect(arrivals).toStrictEqual([0, 0]);
  });

  it("install a throttler once on an Api however often they are asked", async () => {
    const { botApi, throttlers, apiFor } = setUp();
    const api = apiFor(fakeBotToken);
    throttlers.install(api);
    throttlers.install(api);
    await api.sendMessage(ownerId, "once");
    expect(botApi.calls()).toStrictEqual([{ method: "sendMessage", chatId: ownerId }]);
  });

  it("refuse a seventeenth bot token and keep serving the sixteen", () => {
    const { throttlers, apiFor } = setUp();
    const tokens = Array.from({ length: 15 }, (_, index) => `70123${String(index)}:token`);
    const first = "70100:token";
    for (const token of [first, ...tokens]) {
      throttlers.install(apiFor(token));
    }
    expect(() => {
      throttlers.install(apiFor("70999:token"));
    }).toThrow(expect.objectContaining({ code: "telegram.too_many_bots" }));
    expect(() => {
      throttlers.install(apiFor(first));
    }).not.toThrow();
  });
});
