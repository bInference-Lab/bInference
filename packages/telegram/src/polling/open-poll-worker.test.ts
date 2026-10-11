import { createSecret, type Http, type HttpRequest } from "@binference/core";
import { afterEach, describe, expect, it } from "vitest";
import {
  createFakeBotApi,
  type FakeBotApi,
  fakeBotApiBase,
  fakeBotToken,
} from "../testing/fake-bot-api.js";
import { ownerId, textUpdate } from "../testing/update-fixtures.js";
import { openPollWorker, type PollWorker, pollWorker } from "./open-poll-worker.js";

// Workers run the TypeScript source, as the store's tests do.
const execArgv = ["--conditions=@binference/source", "--import", "tsx"];
const workerTest = { timeout: 60_000 };
// Each call gets its own 30 s: one signal made at import would bound the whole file.
const live = (): { readonly signal: AbortSignal } => ({ signal: AbortSignal.timeout(30_000) });

const opened: PollWorker[] = [];
afterEach(async () => {
  await Promise.all(opened.splice(0).map(async (worker) => worker.close()));
});

// A Bot API holding updates 1 and 2, and the requests that reached it through the parent's Http.
function botApi(): { readonly api: FakeBotApi; readonly http: Http; readonly sent: HttpRequest[] } {
  const api = createFakeBotApi();
  api.push(
    textUpdate({ updateId: 1, from: ownerId, text: "one" }),
    textUpdate({ updateId: 2, from: ownerId, text: "two" }),
  );
  const sent: HttpRequest[] = [];
  const http: Http = {
    request: async (request) => {
      sent.push(request);
      return api.http.request(request);
    },
  };
  return { api, http, sent };
}

function open(token: string, http: Http = botApi().http): PollWorker {
  const options = { worker: pollWorker, token: createSecret(token), http, execArgv };
  const worker = openPollWorker(options);
  opened.push(worker);
  return worker;
}

describe("the poll worker", () => {
  it(
    "fetches updates in its own thread and drops those an offset acknowledges",
    workerTest,
    async () => {
      const worker = open(fakeBotToken);
      const first = await worker.fetch(undefined, live());
      expect(first.map((polled) => polled.updateId)).toStrictEqual([1, 2]);
      expect(first[0]?.update).toMatchObject({ update_id: 1, message: { text: "one" } });
      const again = await worker.fetch(2, live());
      expect(again.map((polled) => polled.updateId)).toStrictEqual([2]);
    },
  );

  it("cancels a long poll on abort and refuses calls once closed", workerTest, async () => {
    const worker = open(fakeBotToken);
    const controller = new AbortController();
    const waiting = worker.fetch(3, { signal: controller.signal });
    const reason = new Error("stopped by the test");
    controller.abort(reason);
    await expect(waiting).rejects.toBe(reason);
    await worker.close();
    await expect(worker.fetch(3, live())).rejects.toMatchObject({ code: "telegram.poller_closed" });
  });

  it(
    "brings a refusal across the thread by its code, never with the token",
    workerTest,
    async () => {
      const token = "7012345678:AAE_aDifferentTokenTheFakeRefuses_01234";
      const refused: unknown = await open(token)
        .fetch(undefined, live())
        .catch((error: unknown) => error);
      expect(refused).toMatchObject({ code: "telegram.bad_token", retryable: false });
      expect(JSON.stringify(refused)).not.toContain(token);
      expect((refused as Error).stack).not.toContain(token);
    },
  );

  it("sends grammY's requests through the parent's outbound HTTP", workerTest, async () => {
    const bot = botApi();
    await open(fakeBotToken, bot.http).fetch(undefined, live());
    expect(bot.sent).toHaveLength(1);
    expect(bot.sent[0]).toMatchObject({
      method: "POST",
      url: `${fakeBotApiBase}/getUpdates`,
      headers: { "content-type": "application/json" },
    });
  });

  it("says a request that got no answer is unreachable, to try again", workerTest, async () => {
    const bot = botApi();
    bot.api.failNext("getUpdates", "network");
    await expect(open(fakeBotToken, bot.http).fetch(undefined, live())).rejects.toMatchObject({
      code: "telegram.unreachable",
      retryable: true,
    });
  });

  it("names its entry beside its own module", () => {
    expect(pollWorker.pathname).toMatch(/\/polling\/poll\.worker\.ts$/);
  });
});
