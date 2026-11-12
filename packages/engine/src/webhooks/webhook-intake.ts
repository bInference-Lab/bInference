import { Buffer } from "node:buffer";
import { timingSafeEqual } from "node:crypto";
import { type Clock, type Id, idSchema } from "@binference/core";
import { type Sha256Hex, sha256Hex, sha256HexOfBytes } from "../records/sha256-hex.js";
import { readAlertBody } from "./alert-body.schema.js";
import { createReadBudget, createRefusalCounts } from "./intake-bounds.js";
import type { WebhookAlertStore } from "./ports.js";
import {
  isAnswering,
  type WebhookAlertDraft,
  type WebhookRuleKey,
  type WebhookTake,
} from "./webhook-alert.js";

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
 * or a rule that is not answering, alike; `repeat` (409), `rate` (429), and `too_deep` (400) for a
 * JSON body nested past `maxJsonDepth`, which records nothing (decision 0417).
 */
export type WebhookAnswer = "accepted" | "not_found" | "repeat" | "rate" | "too_deep";

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

// The alert a request's body makes for its rule, or `too_deep` for a JSON body nested past the bound,
// which records nothing (decision 0417).
function draftOf(
  request: WebhookRequest,
  at: {
    readonly rule: WebhookRuleKey;
    readonly secretHash: Sha256Hex;
    readonly receivedAtMs: number;
    readonly isLocked: boolean;
  },
): WebhookAlertDraft | "too_deep" {
  const read = readAlertBody(request.body);
  if (read === "too_deep") {
    return read;
  }
  return {
    rule: at.rule.id,
    secretHash: at.secretHash,
    ...read,
    bodyHash: sha256HexOfBytes(request.body),
    receivedAtMs: at.receivedAtMs,
    ...(at.isLocked ? { isEngineLocked: true as const } : {}),
  };
}

/**
 * Creates the intake of the webhook listener (spec 1, section 2.2; decisions 0299 and 0333). The
 * secret's SHA-256 is compared in constant time with the rule's stored hash, or with a decoy's
 * when no rule has the id, so a wrong secret and an unknown rule make the same read and the same
 * comparison before the same answer. Only a rule that is `active` and not expired answers; its
 * alert is then recorded through the store, which judges repeats and the rate in the same write,
 * with whether the engine was locked as it arrived.
 * Past `webhookReadsPerSecond` reads a second, a request is a 404 with no read; past its rule's
 * refusals for the minute, an alert is a 429 with no write (`intake-bounds.ts`).
 */
export function createWebhookIntake(options: {
  readonly store: WebhookAlertStore;
  readonly clock: Clock;
  /** Whether the engine is locked now; an alert taken while it is skips its fill (decision 0336). */
  readonly isLocked: () => boolean;
}): WebhookIntake {
  const { store, clock, isLocked } = options;
  const reads = createReadBudget(clock);
  const refusals = createRefusalCounts(clock);
  // The rule whose URL the request names, when its secret matches and it answers now.
  const matchedRule = async (
    request: WebhookRequest,
    secretHash: Sha256Hex,
    call: { readonly signal: AbortSignal },
  ): Promise<WebhookRuleKey | undefined> => {
    const id = ruleIdOf(request.ruleId);
    const canRead = id !== undefined && reads.take();
    const rule = canRead ? await store.findRule(id, call) : undefined;
    const isMatch = isSameHash(rule?.secretHash ?? decoyHash, secretHash);
    return rule !== undefined && isMatch && isAnswering(rule, clock.now()) ? rule : undefined;
  };
  return {
    async take(request, call) {
      const receivedAtMs = clock.now();
      const secretHash = sha256Hex(request.secret);
      const rule = await matchedRule(request, secretHash, call);
      if (rule === undefined) {
        return "not_found";
      }
      if (refusals.isFull(rule.id, rule.ratePerMinute)) {
        return "rate";
      }
      const draft = draftOf(request, { rule, secretHash, receivedAtMs, isLocked: isLocked() });
      if (draft === "too_deep") {
        refusals.count(rule.id);
        return "too_deep";
      }
      const taken = await store.take(draft, call);
      if (taken.kind === "repeat" || taken.kind === "rate") {
        refusals.count(rule.id);
      }
      return answers[taken.kind];
    },
  };
}
