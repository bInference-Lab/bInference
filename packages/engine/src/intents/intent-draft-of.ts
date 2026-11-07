import type { Id, IdSource, JsonValue } from "@binference/core";
import type {
  AssetInfos,
  AutoOrderRequest,
  IntentRequest,
  RescueRequest,
  UnfreezeRequest,
  WebhookRuleCardRequest,
} from "@binference/protocol";
import { configChangeRequestDocument } from "../config-changes/config-change-quote.js";
import type { ConfigChangeRequest } from "../config-changes/config-change-quote.js";
import { autoOrderRequestDocument } from "../orders/auto-order-quote.js";
import { webhookRuleCardRequestDocument } from "../webhooks/webhook-rule-quote.js";
import {
  assetsDocument,
  authorizationDocument,
  requestDocument,
} from "./intent-documents.schema.js";
import type { IntentDraft, IntentProposerRef } from "./intent-record.js";
import type { IntentStep } from "./state-machine.js";
import { unfreezeRequestDocument } from "./unfreeze-quote.js";

/** Every request an intent is created with. */
type CreatedRequest =
  | IntentRequest
  | RescueRequest
  | UnfreezeRequest
  | AutoOrderRequest
  | WebhookRuleCardRequest
  | ConfigChangeRequest;

/** A new intent to store: the state machine's step into `proposed`, and what it was asked. */
export interface NewIntent {
  readonly id: Id<"int">;
  readonly agentId: Id<"agt">;
  readonly walletId: Id<"wal">;
  /**
   * What was asked: a proposal's request, the rescue's, the unfreeze's, an auto order's or a
   * webhook rule's.
   */
  readonly request: CreatedRequest;
  /** Who called, as the intents table keeps it: the token or device, `telegram` or `engine`. */
  readonly proposerRef: IntentProposerRef;
  readonly step: IntentStep;
  /**
   * What each token it names and the registry does not list answered on chain, read at the
   * proposal; absent when it names none.
   */
  readonly assets?: AssetInfos;
  /** The launch draft whose Start proposed it (decision 0288); absent for any other intent. */
  readonly draftRef?: string;
}

function requestOf(request: CreatedRequest): JsonValue {
  if (request.kind === "unfreeze") {
    return unfreezeRequestDocument.encode(request);
  }
  if (request.kind === "webhookRule") {
    return webhookRuleCardRequestDocument.encode(request);
  }
  if (request.kind === "configChange") {
    return configChangeRequestDocument.encode(request);
  }
  if (request.kind === "autoOrder") {
    return autoOrderRequestDocument.encode(request);
  }
  return request.kind === "rescue" ? { kind: request.kind } : requestDocument.encode(request);
}

/**
 * The draft the intent store writes for a new intent. Its first event's cause names who proposed
 * it, which the state machine reads back with every later move; a fill keeps the order or rule
 * that authorizes it from the start.
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
    ...(status.authorizedBy === undefined
      ? {}
      : { authorizedBy: authorizationDocument.encode(status.authorizedBy) }),
    ...(intent.assets === undefined ? {} : { assets: assetsDocument.encode(intent.assets) }),
    ...(intent.draftRef === undefined ? {} : { draftRef: intent.draftRef }),
    atMs: event.atMs,
    cause,
    ...(event.hasLedgerEntry ? { ledger } : {}),
  };
}
