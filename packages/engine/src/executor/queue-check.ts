import {
  type AccountRef,
  type AllowedTargets,
  accountRefSchema,
  checkAutoModeGrant,
  declaredContracts,
  type RegisteredChain,
  type SignAuthorization,
  type VenueDeclaration,
} from "@binference/chain";
import type { Clock } from "@binference/core";
import type { QuoteView } from "@binference/protocol";
import type { LimitsValues } from "../agents/limits-record.js";
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
  /** The venues' declarations, which name the contracts a trade's steps may reach. */
  readonly venues: readonly VenueDeclaration[];
}

interface Rechecked {
  readonly hasPassed: boolean;
  readonly networkFeeCapNativeBase?: bigint;
}

// The policy runs again on the request and the confirmed quote, with the facts now of the wallet
// the intent was stored for, the intent's own outflow left out of the agent's (decision 0136). An
// auto intent that now sells a denied token fails it: only a tap confirms that (decision 0101).
async function recheckPolicy(
  snapshot: IntentSnapshot,
  parts: QueueCheckParts,
  signal: AbortSignal,
): Promise<Rechecked> {
  const { record, settings, stored } = snapshot;
  const request = { ...requestDocument.decode(record.request), wallet: record.walletId };
  const resolving = { request, settings, signal, intent: record.id };
  const resolved = await resolveProposal(parts, resolving);
  if (!resolved.ok || record.quote === undefined) {
    return { hasPassed: false };
  }
  const { swap, facts, chain, nativeAsset } = resolved.value;
  const quote = quoteDocument.decode(record.quote);
  const nowMs = parts.clock.now();
  const policyFacts = policyFactsOf({
    settings,
    wallet: facts,
    chain: chain.ref,
    chains: parts.chains,
    nativeAsset,
    nowMs,
  });
  const verdict = await parts.policy.check(swapSubjectOf(swap, stored.status), policyFacts, {
    signal,
    quote: { amountIn: quote.amountIn, expectedOut: quote.expectedOut },
  });
  const isAuto = stored.status.authorizedBy !== undefined;
  const hasPassed =
    verdict.ok && !(isAuto && verdict.value.sellsDeniedToken) && quoteHolds(quote, settings.limits);
  return { hasPassed, networkFeeCapNativeBase: facts.networkFeeCapNativeBase };
}

// The confirmed quote must still fit the agent's limits now: each venue of its route allowed and
// its price impact at most the maximum. A stricter limit set since the tap applies at once
// (decision 0111).
function quoteHolds(quote: QuoteView, limits: LimitsValues): boolean {
  return (
    quote.route.length > 0 &&
    quote.route.every(({ venue }) => limits.venues.includes(venue)) &&
    quote.priceImpactBps <= limits.priceImpactBps
  );
}

/**
 * The registry's set for the intent's steps: the contracts the venues of its quote's route
 * declare on the chain, read from the registry by name as the ceiling reads them, which are also
 * the spenders an approval may name. A venue no declaration names, or one that names a contract
 * the registry lacks, adds none. A swap sends to no one.
 */
function allowedTargetsOf(
  snapshot: IntentSnapshot,
  context: { readonly chain: RegisteredChain; readonly venues: readonly VenueDeclaration[] },
): AllowedTargets {
  const { chain } = context;
  const quote =
    snapshot.record.quote === undefined ? undefined : quoteDocument.decode(snapshot.record.quote);
  const used = new Set(quote?.route.map((leg) => leg.venue) ?? []);
  const addresses = context.venues
    .filter((venue) => used.has(venue.id))
    .flatMap((venue) => {
      const declared = declaredContracts(venue, chain);
      return declared.ok ? declared.value : [];
    });
  const contracts: readonly AccountRef[] = [...new Set(addresses)].map((address) =>
    accountRefSchema.parse(`${chain.ref}:${address}`),
  );
  return { contracts, spenders: contracts, recipients: [] };
}

/** What the owner's confirmation of the intent lets the signer check, once it is stored. */
export async function confirmationTerms(
  snapshot: IntentSnapshot,
  parts: Pick<QueueCheckParts, "intents">,
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
  const allowed = allowedTargetsOf(snapshot, { chain, venues: parts.venues });
  return { facts, isAuto, ...(terms === undefined ? {} : { terms: { ...terms, allowed } }) };
}
