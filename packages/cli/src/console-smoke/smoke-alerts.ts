import { directRoute } from "@binference/core";
import { createMemoryLogger } from "@binference/core/testing";
import { createWebhookIntake } from "@binference/engine/orders";
import { createWebhookListener } from "@binference/server";
import type { Skeleton } from "../compose/test-skeleton.js";
import { createSystemHttp } from "../runtime/system-http.js";

/** What one alert to a rule's URL came to: the listener's answer, and the rule's fills after. */
interface SmokeAlert {
  readonly status: number;
  readonly fills: number;
}

/** The smoke engine's webhook listener, which the browser test sends alerts to. */
export interface SmokeAlerts {
  /**
   * Sends the alert to the rule's URL as an alert sender would, with the listener's port in place
   * of the URL's own, then runs the waiting fills, and reads how many times the rule filled.
   */
  post(url: string, body: string): Promise<SmokeAlert>;
  close(): Promise<void>;
}

const live = (): { readonly signal: AbortSignal } => ({ signal: AbortSignal.timeout(10_000) });

/**
 * Starts the webhook listener of the smoke engine on a free loopback port, over the skeleton's
 * own stores, as the engine's start binds it at `engine.webhookPort`.
 */
export async function startSmokeAlerts(skeleton: Skeleton): Promise<SmokeAlerts> {
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
  const http = createSystemHttp({ version: "smoke", route: directRoute });
  return {
    async post(url, body) {
      const { pathname } = new URL(url);
      const target = `http://127.0.0.1:${String(address.port)}${pathname}`;
      const answer = await http.request({ method: "POST", url: target, body, ...live() });
      await skeleton.composed.engine.fillWebhookAlerts(live());
      const [rule] = pathname.split("/").slice(2, 3);
      const { items } = await skeleton.client.call("webhookRule/list", {}, live());
      const fills = items.find((each) => each.rule === rule)?.fills ?? 0;
      return { status: answer.status, fills };
    },
    close: async () => listener.close(),
  };
}
