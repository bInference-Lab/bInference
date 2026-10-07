import { stableJson } from "@binference/core";
import { isFillAuthorization } from "../intents/authorization.js";
import { cardExpiresAt } from "../intents/card-rules.js";
import type { IntentSnapshot } from "../intents/create-stored-intents.js";
import type { IntentKind } from "../intents/intent-kind.js";
import type { IntentRecord } from "../intents/intent-record.js";
import { type Sha256Hex, sha256Hex } from "../records/sha256-hex.js";
import { type AutoModeGrant, type AutoModeKind, autoModeKinds } from "./auto-mode-grant.js";

const grantKinds: ReadonlySet<IntentKind> = new Set<IntentKind>(autoModeKinds);

function isAutoModeKind(kind: IntentKind): kind is AutoModeKind {
  return grantKinds.has(kind);
}

/**
 * The terms hash of an intent the auto mode authorized under one mode version: the SHA-256 of the
 * intent's id, the mode and its version, the request and the quote, as a card's terms hash covers
 * what the card shows. The engine sends it with each signing request of the intent, and the grant
 * holds only while the two match.
 */
export function autoModeTermsHash(record: IntentRecord, modeVersion: number): Sha256Hex {
  const terms = {
    intent: record.id,
    approvalMode: "auto",
    modeVersion,
    request: record.request,
    quote: record.quote ?? null,
  };
  return sha256Hex(stableJson(terms));
}

/** The chain facts a grant carries, read as the engine builds the signing request. */
export interface AutoModeGrantChain {
  /** The network fee cap of the intent's chain (decision 0102). */
  readonly networkFeeCapNativeBase: bigint;
}

/**
 * The auto grant of a stored intent the auto mode authorized: granted when the intent moved to
 * `confirmed`, for the card lifetime its kind would have had, up to the chain's network fee cap.
 * `undefined` for an intent the owner tapped or an order or webhook rule filled, and for one the
 * auto mode has not authorized.
 */
export function autoModeGrantOf(
  snapshot: IntentSnapshot,
  chain: AutoModeGrantChain,
): AutoModeGrant | undefined {
  const { record, history, stored } = snapshot;
  const { authorizedBy } = stored.status;
  const confirmed = history.events.find((event) => event.toState === "confirmed");
  if (
    authorizedBy === undefined ||
    isFillAuthorization(authorizedBy) ||
    confirmed === undefined ||
    !isAutoModeKind(record.kind)
  ) {
    return undefined;
  }
  return {
    approvalMode: "auto",
    agent: record.agentId,
    intent: record.id,
    kind: record.kind,
    modeVersion: authorizedBy.modeVersion,
    termsHash: autoModeTermsHash(record, authorizedBy.modeVersion),
    grantedAtMs: confirmed.atMs,
    expiresAtMs: cardExpiresAt(record.kind, confirmed.atMs, stored.cards),
    networkFeeCapNativeBase: chain.networkFeeCapNativeBase,
  };
}
