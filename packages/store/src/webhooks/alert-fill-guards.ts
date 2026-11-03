import type { DatabaseSync } from "node:sqlite";
import type { AlertFillWrite } from "@binference/engine/orders";
import { inFlightStates, ruleFillOfAuthorization } from "@binference/engine/outflows";
import type { Selectable } from "kysely";
import type { EngineTables } from "../databases/engine-tables.js";
import type { WebhookEventsTable } from "../databases/webhook-tables.js";
import { createSyncKysely } from "../dialect/sync-kysely.js";
import { readJson } from "../rows/column-values.js";
import { ruleRow } from "./webhook-rule-rows.js";

/**
 * The live fill of an accepted alert that the executor holds, by the alert's row (decision
 * 0342): the engine's live intent of the rule's agent in a state the executor holds whose
 * authorization names this rule and row; `undefined` when there is none.
 */
function heldFillOf(
  database: DatabaseSync,
  row: Selectable<WebhookEventsTable>,
): string | undefined {
  const agent = ruleRow(database, row.rule_id)?.agent_id;
  if (agent === undefined) {
    return undefined;
  }
  const { kysely, execute } = createSyncKysely<EngineTables>(database);
  const held = execute(
    kysely
      .selectFrom("intents")
      .select(["id", "authorized_by"])
      .where("agent_id", "=", agent)
      .where("paper", "=", 0)
      .where("proposer", "=", "engine")
      .where("state", "in", [...inFlightStates]),
  ).rows;
  const found = held.find(({ authorized_by: text }) => {
    const fill = text === null ? undefined : ruleFillOfAuthorization(readJson(text));
    return fill?.rule === row.rule_id && fill.event === row.id;
  });
  return found?.id;
}

/**
 * Whether a skip would end an alert whose live fill the executor holds, for any but that fill
 * itself: only the fill's own move may end the alert (decision 0342).
 */
export function isHeldFromSkip(
  database: DatabaseSync,
  end: { readonly row: Selectable<WebhookEventsTable>; readonly write: AlertFillWrite },
): boolean {
  const { row, write } = end;
  const held = write.outcome === "skipped" ? heldFillOf(database, row) : undefined;
  return held !== undefined && held !== write.intentId;
}

/**
 * Whether a `filled` end written alone names the alert's own fill (decision 0342): an intent whose
 * stored authorization is this rule's fill of this row.
 */
export function namesOwnFill(database: DatabaseSync, write: AlertFillWrite): boolean {
  if (write.intentId === undefined) {
    return false;
  }
  const { kysely, takeFirst } = createSyncKysely<EngineTables>(database);
  const intent = takeFirst(
    kysely.selectFrom("intents").select("authorized_by").where("id", "=", write.intentId),
  );
  const row = takeFirst(
    kysely.selectFrom("webhook_events").select("rule_id").where("id", "=", write.event),
  );
  const text = intent?.authorized_by ?? null;
  const fill = text === null ? undefined : ruleFillOfAuthorization(readJson(text));
  return row !== undefined && fill?.rule === row.rule_id && fill.event === write.event;
}
