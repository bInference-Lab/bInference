import { directRoute } from "@binference/core";
import { createMemoryLogger } from "@binference/core/testing";
import { createWebhookIntake } from "@binference/engine/orders";
import { createWebhookListener } from "@binference/server";
import type { ComposedSkeleton } from "../compose/test-skeleton.js";
import { createSystemHttp } from "../runtime/system-http.js";

/** The webhook listener on a loopback port of its own, and how a test posts alerts to it. */
export interface AlertPoster {
  /**
   * Posts an alert to a rule's URL, with the listener's port in place of the URL's own, and
   * answers the listener's status.
   */
  post(url: string, body: string, headers?: Readonly<Record<string, string>>): Promise<number>;
  /** Stops the listener. */
  close(): Promise<void>;
}

const http = createSystemHttp({ version: "test", route: directRoute });

/**
 * Starts the webhook listener on a free loopback port over the skeleton's own alert store and
 * clock, as the self-hosted engine starts it, never locked; the test closes it.
 */
export async function listenForAlerts(
  skeleton: Pick<ComposedSkeleton, "parts" | "clock">,
): Promise<AlertPoster> {
  const listener = createWebhookListener({
    port: 0,
    intake: createWebhookIntake({
      store: skeleton.parts.stores.webhookAlerts,
      clock: skeleton.clock,
      isLocked: () => false,
    }),
    clock: skeleton.clock,
    logger: createMemoryLogger({ subsystem: "webhook" }),
  });
  const address = await listener.start(new AbortController().signal);
  return {
    async post(url, body, headers = {}) {
      const { pathname } = new URL(url);
      const answer = await http.request({
        method: "POST",
        url: `http://127.0.0.1:${String(address.port)}${pathname}`,
        headers,
        body,
        signal: AbortSignal.timeout(10_000),
      });
      return answer.status;
    },
    close: async () => listener.close(),
  };
}
