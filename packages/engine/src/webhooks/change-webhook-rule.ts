import { err, type Id, ok, type Result } from "@binference/core";
import type { ProtocolErrorCode } from "@binference/protocol";
import type { Answerer } from "../confirmations/card-answer.js";
import { cancelCard } from "../orders/cancel-order.js";
import { noticePush } from "../pushes/notice-push.js";
import type { WebhookRuleParts } from "./webhook-rule-parts.js";
import type { WebhookRuleMove, WebhookRuleRecord } from "./webhook-rule-record.js";
import { newWebhookSecret, webhookUrlOf } from "./webhook-secret.js";

// A change reads again and writes again when another write, such as a fill or a tap, moved the rule
// first; five rounds outlast any burst of moves, and a change never gives up quietly.
const maxRounds = 5;

type Changed<T> = Result<T, ProtocolErrorCode | "stale">;

// Writes one change of a rule that is active or awaiting its card, under the version read; a rule
// in no such state is `webhook.not_found`, and another write that came first `stale`.
async function changeOnce<T>(
  parts: WebhookRuleParts,
  call: {
    readonly rule: Id<"whr">;
    readonly moveOf: (rule: WebhookRuleRecord) => {
      readonly move: WebhookRuleMove;
      readonly answer: T;
    };
    readonly signal: AbortSignal;
  },
): Promise<Changed<{ readonly before: WebhookRuleRecord; readonly answer: T }>> {
  const { rule: id, moveOf, signal } = call;
  const before = await parts.rules.get(id, { signal });
  if (before === undefined || before.state === "deleted") {
    return err("webhook.not_found");
  }
  const { move, answer } = moveOf(before);
  const written = await parts.rules.move(move, { signal });
  if (written.ok) {
    return ok({ before, answer });
  }
  return written.error === "stale" ? err("stale") : err("webhook.not_found");
}

async function changeRule<T>(
  parts: WebhookRuleParts,
  call: Parameters<typeof changeOnce<T>>[1],
  round = 1,
): Promise<Result<{ readonly before: WebhookRuleRecord; readonly answer: T }, ProtocolErrorCode>> {
  const changed = await changeOnce(parts, call);
  if (changed.ok) {
    return changed;
  }
  if (changed.error !== "stale") {
    return err(changed.error);
  }
  return round >= maxRounds ? err("internal.error") : changeRule(parts, call, round + 1);
}

/**
 * Deletes a webhook rule at once, with no card (decision 0337): an active rule's URL gets `404`
 * from this write on, and a rule awaiting its card has its card cancelled. Alerts it took that
 * still wait fill nothing. A rule that is not active or awaiting its card is `webhook.not_found`.
 */
export async function deleteWebhookRule(
  parts: WebhookRuleParts,
  call: { readonly rule: Id<"whr">; readonly signal: AbortSignal },
): Promise<Result<undefined, ProtocolErrorCode>> {
  const { signal } = call;
  const deleted = await changeRule(parts, {
    rule: call.rule,
    signal,
    moveOf: (rule) => ({
      move: {
        id: rule.id,
        expectedVersion: rule.version,
        state: "deleted",
        atMs: parts.clock.now(),
      },
      answer: undefined,
    }),
  });
  if (!deleted.ok) {
    return deleted;
  }
  const { before } = deleted.value;
  if (before.state === "awaiting_confirmation") {
    await cancelCard(parts, before.intentId, signal);
  }
  return ok(undefined);
}

/**
 * Gives a webhook rule a new URL at once, with no card (decision 0337): a new 32-byte secret,
 * whose SHA-256 replaces the old one in the same write, so the old URL gets `404` from then on, and
 * alerts it took that still wait fill nothing (`url_rotated`). It answers the new URL this once and
 * tells the owner with `notice.webhookRotated`, naming the surface. A rule that is not active or
 * awaiting its card is `webhook.not_found`.
 */
export async function rotateWebhookUrl(
  parts: WebhookRuleParts,
  call: { readonly rule: Id<"whr">; readonly by: Answerer; readonly signal: AbortSignal },
): Promise<Result<string, ProtocolErrorCode>> {
  const rotated = await changeRule(parts, {
    rule: call.rule,
    signal: call.signal,
    moveOf: (rule) => {
      const { secret, secretHash } = newWebhookSecret(parts.secretRandom);
      const move = {
        id: rule.id,
        expectedVersion: rule.version,
        state: rule.state,
        atMs: parts.clock.now(),
        secretHash,
      };
      return { move, answer: webhookUrlOf(parts.webhookBase(), rule.id, secret) };
    },
  });
  if (!rotated.ok) {
    return rotated;
  }
  const { before, answer } = rotated.value;
  const values = { name: before.request.name, surface: call.by.surface };
  parts.publish(noticePush({ key: "notice.webhookRotated", agent: before.agentId, values }));
  return ok(answer);
}
