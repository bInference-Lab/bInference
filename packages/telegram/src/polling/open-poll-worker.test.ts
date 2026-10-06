import { createSecret } from "@binference/core";
import { afterEach, describe, expect, it } from "vitest";
import { fakeBotToken } from "../testing/fake-bot-api.js";
import { openPollWorker, type PollWorker, pollWorker } from "./open-poll-worker.js";

// Workers run the TypeScript source, as the store's tests do.
const execArgv = ["--conditions=@binference/source", "--import", "tsx"];
const fakeApiWorker = new URL("../testing/fake-api.worker.ts", import.meta.url);
const workerTest = { timeout: 60_000 };
const live = { signal: AbortSignal.timeout(30_000) };

const opened: PollWorker[] = [];
afterEach(async () => {
  await Promise.all(opened.splice(0).map(async (worker) => worker.close()));
});

function open(token: string): PollWorker {
  const worker = openPollWorker({ worker: fakeApiWorker, token: createSecret(token), execArgv });
  opened.push(worker);
  return worker;
}

describe("the poll worker", () => {
  it(
    "fetches updates in its own thread and drops those an offset acknowledges",
    workerTest,
    async () => {
      const worker = open(fakeBotToken);
      const first = await worker.fetch(undefined, live);
      expect(first.map((polled) => polled.updateId)).toStrictEqual([1, 2]);
      expect(first[0]?.update).toMatchObject({ update_id: 1, message: { text: "one" } });
      const again = await worker.fetch(2, live);
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
    await expect(worker.fetch(3, live)).rejects.toMatchObject({ code: "telegram.poller_closed" });
  });

  it(
    "brings a refusal across the thread by its code, never with the token",
    workerTest,
    async () => {
      const token = "7012345678:AAE_aDifferentTokenTheFakeRefuses_01234";
      const refused: unknown = await open(token)
        .fetch(undefined, live)
        .catch((error: unknown) => error);
      expect(refused).toMatchObject({ code: "telegram.bad_token", retryable: false });
      expect(JSON.stringify(refused)).not.toContain(token);
      expect((refused as Error).stack).not.toContain(token);
    },
  );

  it("names its entry beside its own module", () => {
    expect(pollWorker.pathname).toMatch(/\/polling\/poll\.worker\.ts$/);
  });
});
