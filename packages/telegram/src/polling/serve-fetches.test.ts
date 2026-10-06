import { MessageChannel, type MessagePort } from "node:worker_threads";
import { Api } from "grammy";
import { afterEach, describe, expect, it } from "vitest";
import { createFakeBotApi, fakeBotToken } from "../testing/fake-bot-api.js";
import { ownerId, textUpdate } from "../testing/update-fixtures.js";
import { pollReplyOf } from "./poll-messages.schema.js";
import { serveFetches } from "./serve-fetches.js";
import { createApiFetcher } from "./update-fetcher.js";

const channels: MessageChannel[] = [];
afterEach(() => {
  for (const channel of channels.splice(0)) {
    channel.port1.close();
  }
});

// The parent's end of a channel whose other end a fetcher serves, as a worker's port would.
function serve(botApi = createFakeBotApi()): {
  readonly parent: MessagePort;
  readonly botApi: typeof botApi;
} {
  const channel = new MessageChannel();
  channels.push(channel);
  serveFetches(channel.port2, createApiFetcher(new Api(fakeBotToken, { fetch: botApi.fetch })));
  return { parent: channel.port1, botApi };
}

async function nextReply(port: MessagePort): Promise<ReturnType<typeof pollReplyOf>> {
  return new Promise((resolve) => {
    port.once("message", (value) => resolve(pollReplyOf(value)));
  });
}

describe("serveFetches", () => {
  it("answers a fetch with the updates and a refusal with its fault", async () => {
    const { parent, botApi } = serve();
    botApi.push(textUpdate({ updateId: 3, from: ownerId, text: "x" }));
    parent.postMessage({ kind: "fetch", id: 1 }, []);
    expect(await nextReply(parent)).toMatchObject({
      kind: "updates",
      id: 1,
      updates: [{ updateId: 3 }],
    });
    botApi.failNext("getUpdates", {
      status: 429,
      description: "Too Many Requests",
      retryAfterS: 2,
    });
    parent.postMessage({ kind: "fetch", id: 2, offset: 4 }, []);
    expect(await nextReply(parent)).toStrictEqual({
      kind: "fault",
      id: 2,
      fault: { code: "telegram.flood", retryable: true, retryAfterMs: 2000 },
    });
  });

  it("cancels a waiting fetch, ignores what is not a request and refuses a fifth fetch", async () => {
    const { parent } = serve();
    parent.postMessage({ kind: "nonsense" }, []);
    for (const id of [1, 2, 3, 4]) {
      parent.postMessage({ kind: "fetch", id, offset: 9 }, []);
    }
    parent.postMessage({ kind: "fetch", id: 5, offset: 9 }, []);
    expect(await nextReply(parent)).toMatchObject({
      kind: "fault",
      id: 5,
      fault: { code: "telegram.poller_busy" },
    });
    parent.postMessage({ kind: "cancel", id: 1 }, []);
    expect(await nextReply(parent)).toMatchObject({
      kind: "fault",
      id: 1,
      fault: { code: "telegram.poller_failed" },
    });
  });
});
