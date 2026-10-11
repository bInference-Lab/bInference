import { describe, expect, it } from "vitest";
import type { CardNotificationOptions, PushWorkerScope } from "./assert-worker-scope";
import { installPushWorker } from "./push-worker-handlers";

const intent = "int_0190f1c2-3a4b-7c5d-8e6f-000000000001";
const card = "crd_0190f1c2-3a4b-7c5d-8e6f-000000000001";

/** A push worker's scope that keeps what the worker did. */
function fakeScope(pageUrls: readonly string[]) {
  const listeners = new Map<string, (event: object) => void>();
  const shown: [string, CardNotificationOptions][] = [];
  const opened: string[] = [];
  const told: object[] = [];
  const focused: string[] = [];
  const scope = {
    addEventListener: (type: string, listener: (event: object) => void) => {
      listeners.set(type, listener);
    },
    skipWaiting: async () => undefined,
    registration: {
      showNotification: async (title: string, options: CardNotificationOptions) => {
        shown.push([title, options]);
      },
    },
    clients: {
      claim: async () => undefined,
      matchAll: async () =>
        pageUrls.map((url) => ({
          url,
          focus: async () => {
            focused.push(url);
            return {};
          },
          postMessage: (message: object) => told.push(message),
        })),
      openWindow: async (url: string) => {
        opened.push(url);
        return null;
      },
    },
  } as unknown as PushWorkerScope;
  installPushWorker(scope);
  return { listeners, shown, opened, told, focused };
}

async function fire(
  listeners: ReadonlyMap<string, (event: object) => void>,
  type: string,
  event: object,
): Promise<void> {
  const work: Promise<void>[] = [];
  listeners.get(type)?.({ ...event, waitUntil: (done: Promise<void>) => work.push(done) });
  await Promise.all(work);
}

const push = (message: object) => ({ data: { text: () => JSON.stringify(message) } });

describe("the push worker", () => {
  it("shows an opened card under its intent's tag and lets a close replace it quietly", async () => {
    const { listeners, shown } = fakeScope([]);
    const words = { title: "A card waits", body: "Open the console." };
    await fire(listeners, "push", push({ v: 1, kind: "opened", intent, card, ...words }));
    await fire(listeners, "push", push({ v: 1, kind: "closed", intent, card, ...words }));
    expect(shown).toStrictEqual([
      [
        "A card waits",
        {
          body: "Open the console.",
          tag: intent,
          icon: "/mark.svg",
          renotify: true,
          silent: false,
        },
      ],
      [
        "A card waits",
        {
          body: "Open the console.",
          tag: intent,
          icon: "/mark.svg",
          renotify: false,
          silent: true,
        },
      ],
    ]);
  });

  it("shows nothing for a message that is no card push", async () => {
    const { listeners, shown } = fakeScope([]);
    await fire(listeners, "push", { data: { text: () => "not json" } });
    await fire(listeners, "push", push({ v: 1, kind: "opened", intent: "x", card }));
    await fire(listeners, "push", { data: null });
    expect(shown).toStrictEqual([]);
  });

  it("tells an open console page which card to show, and focuses it", async () => {
    const page = "http://127.0.0.1:7456/ledger";
    const { listeners, told, focused, opened } = fakeScope(["http://127.0.0.1:7456/mini", page]);
    const closed: string[] = [];
    await fire(listeners, "notificationclick", {
      notification: { tag: intent, close: () => closed.push(intent) },
    });
    expect({ closed, told, focused, opened }).toStrictEqual({
      closed: [intent],
      told: [{ type: "card", intent }],
      focused: [page],
      opened: [],
    });
  });

  it("opens the console at the card when no console page is open", async () => {
    const { listeners, opened } = fakeScope(["http://127.0.0.1:7456/mini"]);
    await fire(listeners, "notificationclick", {
      notification: { tag: intent, close: () => undefined },
    });
    expect(opened).toStrictEqual([`/?intent=${intent}`]);
  });
});
