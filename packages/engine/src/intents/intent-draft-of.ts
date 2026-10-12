import type { Id, IdSource, JsonValue } from "@binference/core";
import type {
  AutoOrderRequest,
  IntentRequest,
  RescueRequest,
  UnfreezeRequest,
} from "@binference/protocol";
import { autoOrderRequestDocument } from "../orders/auto-order-quote.js";
import { requestDocument } from "./intent-documents.schema.js";
import type { IntentDraft, IntentProposerRef } from "./intent-record.js";
import type { IntentStep } from "./state-machine.js";
import { unfreezeRequestDocument } from "./unfreeze-quote.js";

/** A new intent to store: the state machine's step into `proposed`, and what it was asked. */
export interface NewIntent {
  readonly id: Id<"int">;
  readonly agentId: Id<"agt">;
  readonly walletId: Id<"wal">;
  /** What was asked: a proposal's request, the rescue's, the unfreeze's or an auto order's. */
  readonly request: IntentRequest | RescueRequest | UnfreezeRequest | AutoOrderRequest;
  /** Who called, as the intents table keeps it: the token or device, `telegram` or `engine`. */
  readonly proposerRef: IntentProposerRef;
  readonly step: IntentStep;
}

function requestOf(
  request: IntentRequest | RescueRequest | UnfreezeRequest | AutoOrderRequest,
): JsonValue {
  if (request.kind === "unfreeze") {
    return unfreezeRequestDocument.encode(request);
  }
  if (request.kind === "autoOrder") {
    return autoOrderRequestDocument.encode(request);
  }
  return request.kind === "rescue" ? { kind: request.kind } : requestDocument.encode(request);
}

/**
 * The draft the intent store writes for a new intent. Its first event's cause names who proposed
 * it, which the state machine reads back with every later move.
 */
export function draftOf(intent: NewIntent, ids: IdSource): IntentDraft {
  const { id, agentId, proposerRef } = intent;
  const { status, event } = intent.step;
  const cause = { trigger: event.trigger, proposer: status.proposer, by: proposerRef };
  const ledger = {
    id: ids.next("led"),
    atMs: event.atMs,
    agentId,
    kind: event.to,
    subject: id,
    data: { ...cause, to: event.to, ...(status.isPaper ? { paper: true } : {}) },
  };
  return {
    id,
    agentId,
    walletId: intent.walletId,
    kind: status.kind,
    state: status.state,
    request: requestOf(intent.request),
    hasOutsideContent: status.hasOutsideContent,
    isPaper: status.isPaper,
    proposer: proposerRef,
    atMs: event.atMs,
    cause,
    ...(event.hasLedgerEntry ? { ledger } : {}),
  };
}
