import { Buffer } from "node:buffer";
import { timingSafeEqual } from "node:crypto";
import { type Clock, type Id, idSchema } from "@binference/core";
import { type Sha256Hex, sha256Hex, sha256HexOfBytes } from "../records/sha256-hex.js";
import { readAlertBody } from "./alert-body.schema.js";
import type { WebhookAlertStore } from "./ports.js";
import { isAnswering, type WebhookTake } from "./webhook-alert.js";

/** One request to the webhook listener's route, `POST /hook/:ruleId/:secret`. */
export interface WebhookRequest {
  /** The path's rule id, as sent. */
  readonly ruleId: string;
  /** The path's secret, as sent. */
  readonly secret: string;
  /** The body, at most 16 KiB, which the listener read whole. */
  readonly body: Readonly<Uint8Array>;
}

/**
 * The listener's answer: `accepted` (202), `not_found` (404) for an unknown rule, a wrong secret
 * or a rule that is not answering, alike; `repeat` (409) and `rate` (429).
 */
export type WebhookAnswer = "accepted" | "not_found" | "repeat" | "rate";

/** Takes the alerts the webhook listener receives. */
export interface WebhookIntake {
  /**
   * Checks a request's rule and secret, then records its alert: an accepted one is in the inbox
   * when this resolves, so the listener answers only after it is stored.
   */
  take(request: WebhookRequest, options: { readonly signal: AbortSignal }): Promise<WebhookAnswer>;
}

// The hash an unknown rule's secret is compared with, so a wrong secret and an unknown rule run
// the same read and the same comparison before the same answer.
const decoyHash = sha256Hex("binference webhook rule that does not exist");

function isSameHash(left: Sha256Hex, right: Sha256Hex): boolean {
  return timingSafeEqual(Buffer.from(left, "hex"), Buffer.from(right, "hex"));
}

function ruleIdOf(text: string): Id<"whr"> | undefined {
  const parsed = idSchema("whr").safeParse(text);
  return parsed.success ? parsed.data : undefined;
}

const answers: Readonly<Record<WebhookTake["kind"], WebhookAnswer>> = {
  accepted: "accepted",
  repeat: "repeat",
  rate: "rate",
  gone: "not_found",
};

/**
 * Creates the intake of the webhook listener (spec 1, section 2.2; decisions 0299 and 0333). The secret's
 * SHA-256 is compared in constant time with the rule's stored hash, or with a decoy's when no rule
 * has the id, so the answer and the work before it do not tell the two apart. Only a rule that
 * is `active` and not expired answers; its alert is then recorded through the store, which judges
 * repeats and the rate in the same write.
 */
export function createWebhookIntake(options: {
  readonly store: WebhookAlertStore;
  readonly clock: Clock;
}): WebhookIntake {
  const { store, clock } = options;
  return {
    async take(request, call) {
      const receivedAtMs = clock.now();
      const id = ruleIdOf(request.ruleId);
      const secretHash = sha256Hex(request.secret);
      const rule = id === undefined ? undefined : await store.findRule(id, call);
      const isMatch = isSameHash(rule?.secretHash ?? decoyHash, secretHash);
      if (rule === undefined || !isMatch || !isAnswering(rule, receivedAtMs)) {
        return "not_found";
      }
      const read = readAlertBody(request.body);
      const bodyHash = sha256HexOfBytes(request.body);
      const draft = { rule: rule.id, secretHash, ...read, bodyHash, receivedAtMs };
      const taken = await store.take(draft, call);
      return answers[taken.kind];
    },
  };
}
