import type { PushWorkerScope, WindowClientLike } from "./assert-worker-scope";
import { readCardPush } from "./card-push.schema";

function isConsolePage(client: WindowClientLike): boolean {
  return !new URL(client.url).pathname.startsWith("/mini");
}

async function openCard(scope: PushWorkerScope, intent: string): Promise<void> {
  const pages = await scope.clients.matchAll({ type: "window", includeUncontrolled: true });
  const page = pages.find(isConsolePage);
  if (page === undefined) {
    await scope.clients.openWindow(`/?intent=${encodeURIComponent(intent)}`);
    return;
  }
  // oxlint-disable-next-line unicorn/require-post-message-target-origin -- a worker's Client.postMessage takes no origin: it reaches only this origin's page
  page.postMessage({ type: "card", intent });
  await page.focus();
}

/**
 * Sets the push worker up on its scope (decision 0158): it takes over the console's pages at once,
 * shows each card push the engine sends as a notification tagged with the intent, so a card's
 * close takes the place of its open, and opens the console at the card when one is clicked: an
 * open console page is told and focused, else a new one opens. It holds no key and answers no
 * card; a Confirm still needs the device's signed connection.
 */
export function installPushWorker(scope: PushWorkerScope): void {
  scope.addEventListener("install", (event) => {
    event.waitUntil(scope.skipWaiting());
  });
  scope.addEventListener("activate", (event) => {
    event.waitUntil(scope.clients.claim());
  });
  scope.addEventListener("push", (event) => {
    const message = readCardPush(event.data?.text() ?? "");
    if (message === undefined) {
      return;
    }
    const shown = scope.registration.showNotification(message.title, {
      body: message.body,
      tag: message.intent,
      icon: "/mark.svg",
      renotify: message.kind === "opened",
      silent: message.kind === "closed",
    });
    event.waitUntil(shown);
  });
  scope.addEventListener("notificationclick", (event) => {
    event.notification.close();
    event.waitUntil(openCard(scope, event.notification.tag));
  });
}
