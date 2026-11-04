import type { Skeleton } from "../compose/test-skeleton.js";
import { listenForAlerts } from "../e2e/alert-poster.js";

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
  const alerts = await listenForAlerts(skeleton);
  return {
    async post(url, body) {
      const status = await alerts.post(url, body);
      await skeleton.composed.engine.fillWebhookAlerts(live());
      const [rule] = new URL(url).pathname.split("/").slice(2, 3);
      const { items } = await skeleton.client.call("webhookRule/list", {}, live());
      const fills = items.find((each) => each.rule === rule)?.fills ?? 0;
      return { status, fills };
    },
    close: async () => alerts.close(),
  };
}
