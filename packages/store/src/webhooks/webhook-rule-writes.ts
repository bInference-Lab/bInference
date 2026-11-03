import type { DatabaseSync } from "node:sqlite";
import { err, ok, type Result } from "@binference/core";
import {
  type AlertFillWrite,
  maxWebhookRulesPerAgent,
  type WebhookRuleCreateRefusal,
  type WebhookRuleDraft,
  type WebhookRuleMove,
  type WebhookRuleMoveRefusal,
  type WebhookRuleRecord,
} from "@binference/engine/orders";
import type { Selectable } from "kysely";
import type { EngineTables } from "../databases/engine-tables.js";
import type { WebhookRulesTable } from "../databases/webhook-tables.js";
import { createSyncKysely } from "../dialect/sync-kysely.js";
import { isAgentFrozen } from "../orders/order-writes.js";
import { jsonText } from "../rows/column-values.js";
import { acceptedRow, refused, ruleRow, ruleRowOf, toRuleRecord } from "./webhook-rule-rows.js";

/**
 * Stores a new rule awaiting its card. An id in use is `exists`, a frozen agent `frozen`, an
 * agent that holds 20 rules active or awaiting their card `too_many`. An unknown agent or a wallet
 * that is not the agent's throws.
 */
export function createRule(
  database: DatabaseSync,
  draft: WebhookRuleDraft,
): Result<WebhookRuleRecord, WebhookRuleCreateRefusal> {
  const { kysely, execute, takeFirst } = createSyncKysely<EngineTables>(database);
  const isFrozen = isAgentFrozen(database, draft.agentId);
  const wallet = takeFirst(
    kysely.selectFrom("wallets").select("agent_id").where("id", "=", draft.walletId),
  );
  if (isFrozen === undefined || wallet?.agent_id !== draft.agentId) {
    throw refused("A rule names an unknown agent or another agent's wallet.", { rule: draft.id });
  }
  if (ruleRow(database, draft.id) !== undefined) {
    return err("exists");
  }
  if (isFrozen) {
    return err("frozen");
  }
  const held = takeFirst(
    kysely
      .selectFrom("webhook_rules")
      .select((row) => row.fn.countAll<number>().as("count"))
      .where("agent_id", "=", draft.agentId)
      .where("state", "in", ["awaiting_confirmation", "active"]),
  );
  if ((held?.count ?? 0) >= maxWebhookRulesPerAgent) {
    return err("too_many");
  }
  execute(kysely.insertInto("webhook_rules").values(ruleRowOf(draft)));
  const row = ruleRow(database, draft.id);
  if (row === undefined) {
    throw refused("A rule did not read back after its write.", { rule: draft.id });
  }
  return ok(toRuleRecord(row));
}

// A move into `active` needs the confirmation of the rule's card on its `webhookRule` intent, and
// an agent that is not frozen; a rule already active keeps its state while its agent is frozen
// (decision 0337).
function activeRefusal(
  database: DatabaseSync,
  row: Selectable<WebhookRulesTable>,
  move: WebhookRuleMove,
): WebhookRuleMoveRefusal | undefined {
  if (move.state !== "active" || row.state === "active") {
    return undefined;
  }
  const { kysely, takeFirst } = createSyncKysely<EngineTables>(database);
  const card = move.cardId ?? row.card_id;
  const confirmation =
    row.intent_id === null
      ? undefined
      : takeFirst(
          kysely
            .selectFrom("confirmations")
            .select("card_id")
            .where("intent_id", "=", row.intent_id),
        );
  if (card === null || confirmation?.card_id !== card) {
    return "not_confirmed";
  }
  return isAgentFrozen(database, row.agent_id) === true ? "frozen" : undefined;
}

/**
 * Checks a rule's move before anything is written: an unknown rule is `not_found`, one at another
 * version `stale`, and a move into `active` without its card's confirmation `not_confirmed`, or
 * of a frozen agent's rule `frozen`. A move out of `deleted` throws.
 */
export function checkRuleMove(
  database: DatabaseSync,
  move: WebhookRuleMove,
): Result<undefined, WebhookRuleMoveRefusal> {
  const row = ruleRow(database, move.id);
  if (row === undefined) {
    return err("not_found");
  }
  if (row.state === "deleted") {
    throw refused("A deleted webhook rule never moves again.", { rule: move.id });
  }
  if (row.version !== move.expectedVersion) {
    return err("stale");
  }
  const refusal = activeRefusal(database, row, move);
  return refusal === undefined ? ok(undefined) : err(refusal);
}

// The last alert row the rule's URL took: a rotation keeps it, so every alert at or below it is
// its old URL's, whatever its time (decision 0337). The listener's write checks the hash in its
// own transaction, so no alert of the old URL lands after the rotation's write.
function lastEventOf(database: DatabaseSync, rule: string): number {
  const { kysely, takeFirst } = createSyncKysely<EngineTables>(database);
  const last = takeFirst(
    kysely
      .selectFrom("webhook_events")
      .select((row) => row.fn.max<number | null>("id").as("last"))
      .where("rule_id", "=", rule),
  );
  return last?.last ?? 0;
}

/** Writes a checked rule move and answers the rule after it. */
export function writeRuleMove(database: DatabaseSync, move: WebhookRuleMove): WebhookRuleRecord {
  const { kysely, execute } = createSyncKysely<EngineTables>(database);
  const { cardId, fills, noticeHour, secretHash } = move;
  const rotation =
    secretHash === undefined
      ? {}
      : {
          secret_hash: secretHash,
          url_changed_at: move.atMs,
          old_url_last_event: lastEventOf(database, move.id),
        };
  execute(
    kysely
      .updateTable("webhook_rules")
      .set((row) => ({
        state: move.state,
        changed_at: move.atMs,
        version: row("version", "+", 1),
        ...(cardId === undefined ? {} : { card_id: cardId }),
        ...(fills === undefined ? {} : { fills }),
        ...rotation,
        ...(noticeHour === undefined
          ? {}
          : {
              notice_window_at: noticeHour.startedAtMs,
              notices_sent: noticeHour.sent,
              notices_held: noticeHour.held,
            }),
      }))
      .where("id", "=", move.id)
      .where("version", "=", move.expectedVersion),
  );
  const row = ruleRow(database, move.id);
  if (row === undefined) {
    throw refused("A rule did not read back after its move.", { rule: move.id });
  }
  return toRuleRecord(row);
}

/**
 * Checks an alert's end before anything is written: an alert that is no accepted alert is
 * `not_found`, one that ended `ended`, and its rule's move that would not land `stale`. A move of
 * another rule than the alert's throws.
 */
export function checkAlertEnd(
  database: DatabaseSync,
  write: AlertFillWrite,
): Result<undefined, "ended" | "not_found" | "stale"> {
  const row = acceptedRow(database, write.event);
  if (row === undefined) {
    return err("not_found");
  }
  if (row.fill_outcome !== null) {
    return err("ended");
  }
  if (write.move === undefined) {
    return ok(undefined);
  }
  if (write.move.id !== row.rule_id) {
    throw refused("An alert's end moves another rule.", { rule: write.move.id });
  }
  return checkRuleMove(database, write.move).ok ? ok(undefined) : err("stale");
}

/** Writes a checked alert's end: its outcome, reason, intent and notices, then its rule's move. */
export function writeAlertEnd(database: DatabaseSync, write: AlertFillWrite): void {
  const { kysely, execute } = createSyncKysely<EngineTables>(database);
  execute(
    kysely
      .updateTable("webhook_events")
      .set({
        fill_outcome: write.outcome,
        fill_reason: write.reason ?? null,
        intent_id: write.intentId ?? null,
        notices: write.notices === undefined ? null : jsonText([...write.notices]),
      })
      .where("id", "=", write.event),
  );
  if (write.move !== undefined) {
    writeRuleMove(database, write.move);
  }
}
