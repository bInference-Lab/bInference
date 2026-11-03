import type { Random } from "@binference/core";
import type { OneCardParts } from "../orders/open-one-card.js";
import type { WebhookRuleStore } from "./ports.js";

/** What the webhook rule operations read and write through, and where their notices go. */
export interface WebhookRuleParts extends OneCardParts {
  readonly rules: WebhookRuleStore;
  /** The operating system's secure generator, which makes each rule's secret (decision 0338). */
  readonly secretRandom: Random;
  /**
   * The base of every rule's URL: the published webhook address (`remote/status`'s `webhookUrl`)
   * when there is one, else the loopback listener's, read each time a URL is shown, before
   * anything is stored; a rejection, when the published address cannot be read, stores nothing.
   */
  readonly webhookBase: (signal: AbortSignal) => Promise<string>;
}
