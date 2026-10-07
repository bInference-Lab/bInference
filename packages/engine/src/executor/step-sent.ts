import { jsonValueSchema } from "@binference/core";
import type { IntentRecord } from "../intents/intent-record.js";
import { ledgerEntryViewOf } from "../ledger/ledger-entry-view.js";
import type { TransactionRecord } from "../wallet-queue/transaction-record.js";
import type { ExecutionRun } from "./executor-run.js";

/**
 * Records that a relay first accepted one step of an intent (spec 6, section 8): a `sent` ledger
 * entry with the step, its transaction, its hash and the relays that took it, and the pushes of
 * the entry and of the intent, which stays `executing`.
 */
export async function recordStepSent(
  run: ExecutionRun,
  intent: IntentRecord,
  sent: { readonly transaction: TransactionRecord; readonly relays: readonly string[] },
): Promise<void> {
  const { parts, signal } = run;
  const { transaction, relays } = sent;
  const entry = await parts.stores.ledger.append(
    {
      id: parts.ids.next("led"),
      atMs: parts.clock.now(),
      agentId: intent.agentId,
      kind: "sent",
      subject: intent.id,
      data: { step: transaction.step, transaction: transaction.id, hash: transaction.hash, relays },
    },
    { signal },
  );
  parts.publish({
    topic: "ledger",
    kind: "ledger/appended",
    data: jsonValueSchema.parse(ledgerEntryViewOf(entry)),
  });
  parts.publish({
    topic: "intent",
    kind: "intent/changed",
    data: {
      intent: intent.id,
      agent: intent.agentId,
      state: intent.state,
      version: intent.version,
      changedAt: intent.changedAtMs,
    },
  });
}
