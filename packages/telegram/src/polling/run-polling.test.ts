import { createSecret, type JsonValue } from "@binference/core";
import { createManualClock, createSeededRandom } from "@binference/core/testing";
import { describe, expect, it } from "vitest";
import type { UpdateIntake } from "../ingress/create-telegram-ingress.js";
import { createFakeBotApi, fakeBotToken } from "../testing/fake-bot-api.js";
import { ownerId, textUpdate } from "../testing/update-fixtures.js";
import { pollWorker } from "./open-poll-worker.js";
import { createPollerLeases } from "./poller-leases.js";
import { runPolling } from "./run-polling.js";

// Workers run the TypeScript source, as the store's tests do.
const execArgv = ["--conditions=@binference/source", "--import", "tsx"];
const workerTest = { timeout: 60_000 };
const noop = (): void => undefined;

describe("runPolling", () => {
  it(
    "polls from a worker, holds the token's lease while it runs and gives it back",
    workerTest,
    async () => {
      const leases = createPollerLeases();
      const received: JsonValue[] = [];
      let secondStored = noop;
      const bothStored = new Promise<void>((resolve) => {
        secondStored = resolve;
      });
      const intake: UpdateIntake = {
        receive: async (update) => {
          received.push(update);
          await Promise.resolve();
          [undefined, undefined, secondStored][received.length]?.();
        },
      };
      const botApi = createFakeBotApi();
      botApi.push(
        textUpdate({ updateId: 1, from: ownerId, text: "one" }),
        textUpdate({ updateId: 2, from: ownerId, text: "two" }),
      );
      const options = {
        worker: pollWorker,
        token: createSecret(fakeBotToken),
        http: botApi.http,
        execArgv,
        leases,
        intake,
        clock: createManualClock(1),
        random: createSeededRandom(1),
      };
      const controller = new AbortController();
      const run = runPolling(options, { signal: controller.signal });
      await bothStored;
      await expect(runPolling(options, { signal: controller.signal })).rejects.toMatchObject({
        code: "telegram.poller_running",
      });
      const reason = new Error("stopped by the test");
      controller.abort(reason);
      await expect(run).rejects.toBe(reason);
      expect(received).toMatchObject([{ update_id: 1 }, { update_id: 2 }]);
      expect(leases.acquire(options.token).ok).toBe(true);
    },
  );
});
