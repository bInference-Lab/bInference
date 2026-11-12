import { BinferenceError, type Http } from "@binference/core";
import { createFakeBotApi, type FakeBotApi } from "@binference/telegram/testing";

/** The synthetic Bot API the smoke's bot talks to, and waits on what it saw. */
export interface SmokeBot {
  readonly api: FakeBotApi;
  /** The fake's `http`, which hears each call as it arrives and once Telegram answered it. */
  readonly http: Http;
  /**
   * Resolves once the check holds, read again at each Bot API call and its answer; rejects with
   * `smoke.timed_out` naming `what` when it still fails after `timeoutMs`.
   */
  until(what: string, check: (api: FakeBotApi) => boolean, timeoutMs: number): Promise<void>;
}

interface Waiter {
  readonly check: (api: FakeBotApi) => boolean;
  readonly done: () => void;
}

/** A synthetic Bot API whose calls the smoke can wait on. */
export function createSmokeBot(): SmokeBot {
  const api = createFakeBotApi();
  const waiters = new Set<Waiter>();
  const heard = (): void => {
    [...waiters]
      .filter((waiter) => waiter.check(api))
      .forEach((waiter) => {
        waiters.delete(waiter);
        waiter.done();
      });
  };
  const http: Http = {
    request: async (request) => {
      // A long poll for updates holds its answer, so it is heard once the fake holds it too. The
      // fake records a call only after it read its body, so one heard as it is sent is missed.
      const answering = api.http.request(request);
      if (new URL(request.url).pathname.endsWith("/getUpdates")) {
        await Promise.race([answering, api.idle()]);
      }
      heard();
      const answer = await answering;
      heard();
      return answer;
    },
  };
  const until = async (what: string, check: Waiter["check"], timeoutMs: number) =>
    check(api)
      ? Promise.resolve()
      : new Promise<void>((resolve, reject) => {
          const timer = setTimeout(() => {
            waiters.delete(waiter);
            const message = `No ${what} in Telegram within ${String(timeoutMs / 1000)} s.`;
            reject(new BinferenceError({ code: "smoke.timed_out", message }));
          }, timeoutMs);
          const waiter = {
            check,
            done: () => {
              clearTimeout(timer);
              resolve();
            },
          };
          waiters.add(waiter);
        });
  return { api, http, until };
}
