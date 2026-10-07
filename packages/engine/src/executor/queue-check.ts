import {
  type AllowedTargets,
  accountRefSchema,
  checkAutoModeGrant,
  type RegisteredChain,
  type SignAuthorization,
} from "@binference/chain";
import type { Clock } from "@binference/core";
import { autoModeGrantOf } from "../approval/auto-mode-grant-of.js";
import { isFillAuthorization } from "../intents/authorization.js";
import type { IntentSnapshot } from "../intents/create-stored-intents.js";
import { quoteDocument, requestDocument } from "../intents/intent-documents.schema.js";
import type { QueueFacts } from "../intents/intent-trigger.js";
import { policyFactsOf } from "../money-path/policy-facts-of.js";
import { type ResolveOptions, resolveProposal } from "../money-path/resolve-proposal.js";
import { swapSubjectOf } from "../money-path/swap-trade.js";
import type { PolicyCheck } from "../policy/check-policy.js";
import type { IntentStore } from "../ports.js";

/** What a signature of the intent's steps carries besides the step itself. */
export interface SigningTerms {
  readonly authorization: SignAuthorization;
  readonly termsHash: string;
  readonly allowed: AllowedTargets;
}

/** What the executor reads as the wallet queue takes an intent. */
export interface QueueCheck {
  /** The facts the state machine's `queue_took` guard reads. */
  readonly facts: QueueFacts;
  /** What the signer checks; absent when nothing the executor can show authorizes the intent. */
  readonly terms?: SigningTerms;
  /** The auto mode authorized the intent, so a fee above the network fee cap never runs. */
  readonly isAuto: boolean;
}

/** The ports and steps the check reads. */
export interface QueueCheckParts extends ResolveOptions {
  readonly intents: IntentStore;
  readonly policy: PolicyCheck;
  readonly clock: Clock;
}

interface Rechecked {
  readonly hasPassed: boolean;
  readonly networkFeeCapNativeBase?: bigint;
}

// The policy runs again on the request and the confirmed quote, with the wallet's facts now. An
// auto intent that now sells a denied token fails it: only a tap confirms that (decision 0101).
async function recheckPolicy(
  snapshot: IntentSnapshot,
  parts: QueueCheckParts,
  signal: AbortSignal,
): Promise<Rechecked> {
  const { record, settings, stored } = snapshot;
  const request = requestDocument.decode(record.request);
  const resolved = await resolveProposal(parts, { request, settings, signal });
  if (!resolved.ok || record.quote === undefined) {
    return { hasPassed: false };
  }
  const { swap, facts, chain, nativeAsset } = resolved.value;
  const quote = quoteDocument.decode(record.quote);
  const verdict = await parts.policy.check(
    swapSubjectOf(swap, stored.status),
    policyFactsOf({ settings, wallet: facts, chain: chain.ref, nativeAsset }),
    { signal, quote: { amountIn: quote.amountIn, expectedOut: quote.expectedOut } },
  );
  const isAuto = stored.status.authorizedBy !== undefined;
  const hasPassed = verdict.ok && !(isAuto && verdict.value.sellsDeniedToken);
  return { hasPassed, networkFeeCapNativeBase: facts.networkFeeCapNativeBase };
}

/**
 * The registry's set for the intent's steps: the contracts the registry lists for the venues of
 * its quote's route, which are also the spenders an approval may name. A swap sends to no one.
 */
function allowedTargetsOf(snapshot: IntentSnapshot, chain: RegisteredChain): AllowedTargets {
  const quote =
    snapshot.record.quote === undefined ? undefined : quoteDocument.decode(snapshot.record.quote);
  const venues = new Set(quote?.route.map((leg) => leg.venue) ?? []);
  const contracts = chain.definition.contracts
    .filter((contract) => venues.has(contract.venue))
    .map((contract) => accountRefSchema.parse(`${chain.ref}:${contract.address}`));
  return { contracts, spenders: contracts, recipients: [] };
}

async function confirmationTerms(
  snapshot: IntentSnapshot,
  parts: QueueCheckParts,
  signal: AbortSignal,
): Promise<Omit<SigningTerms, "allowed"> | undefined> {
  const confirmation = await parts.intents.confirmation(snapshot.record.id, { signal });
  if (confirmation === undefined) {
    return undefined;
  }
  const { id, termsHash, expiresAtMs } = confirmation;
  const intent = snapshot.record.id;
  return {
    authorization: { kind: "confirmation", id, intent, termsHash, expiresAtMs },
    termsHash,
  };
}

// The auto grant holds while the agent's mode keeps the version that authorized the intent.
function autoTerms(
  snapshot: IntentSnapshot,
  rechecked: Rechecked,
  nowMs: number,
): Omit<SigningTerms, "allowed"> | undefined {
  const cap = rechecked.networkFeeCapNativeBase;
  const grant =
    cap === undefined ? undefined : autoModeGrantOf(snapshot, { networkFeeCapNativeBase: cap });
  if (grant === undefined) {
    return undefined;
  }
  const { approvalMode } = snapshot.settings;
  const current = {
    agent: approvalMode.agentId,
    mode: approvalMode.mode,
    version: approvalMode.version,
  };
  const check = { intent: grant.intent, termsHash: grant.termsHash, approvalMode: current, nowMs };
  return checkAutoModeGrant(grant, check).ok
    ? { authorization: { kind: "approvalMode", grant, current }, termsHash: grant.termsHash }
    : undefined;
}

// A tapped intent signs with the owner's confirmation, an auto one with its grant. A fill's order
// or webhook rule has no store yet, so nothing authorizes a fill here.
async function termsOf(
  snapshot: IntentSnapshot,
  rechecked: Rechecked,
  context: { readonly parts: QueueCheckParts; readonly signal: AbortSignal },
): Promise<Omit<SigningTerms, "allowed"> | undefined> {
  const { authorizedBy } = snapshot.stored.status;
  if (authorizedBy === undefined) {
    return confirmationTerms(snapshot, context.parts, context.signal);
  }
  return isFillAuthorization(authorizedBy)
    ? undefined
    : autoTerms(snapshot, rechecked, context.parts.clock.now());
}

/**
 * Reads what the wallet queue checks as it takes a confirmed intent (spec 6, `queue_took`): the
 * agent is live, the policy still passes, and the owner's confirmation or the auto grant still
 * holds; with it, what the signer checks for every step.
 */
export async function checkForQueue(
  snapshot: IntentSnapshot,
  context: { readonly parts: QueueCheckParts; readonly chain: RegisteredChain },
  signal: AbortSignal,
): Promise<QueueCheck> {
  const { parts, chain } = context;
  const { authorizedBy } = snapshot.stored.status;
  const { confirmation } = snapshot.stored;
  const rechecked = await recheckPolicy(snapshot, parts, signal);
  const terms = await termsOf(snapshot, rechecked, { parts, signal });
  const facts: QueueFacts = {
    isAgentLive: snapshot.settings.agent.mode === "live",
    hasPolicyPassed: rechecked.hasPassed,
    ...(confirmation === undefined ? {} : { confirmation }),
    ...(authorizedBy === undefined ? {} : { isAuthorizationValid: terms !== undefined }),
  };
  const isAuto = authorizedBy !== undefined && !isFillAuthorization(authorizedBy);
  const allowed = allowedTargetsOf(snapshot, chain);
  return { facts, isAuto, ...(terms === undefined ? {} : { terms: { ...terms, allowed } }) };
}
