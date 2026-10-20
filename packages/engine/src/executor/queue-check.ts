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
import type { LaunchReadFailure } from "../intents/intent-reason.js";
import type { QueueFacts } from "../intents/intent-trigger.js";
import { quotedTradeOf } from "../money-path/place-trade.js";
import { policyFactsOf } from "../money-path/policy-facts-of.js";
import { type ResolveOptions, resolveProposal } from "../money-path/resolve-proposal.js";
import { swapSubjectOf } from "../money-path/swap-trade.js";
import type { OrderFillReason } from "../orders/order-fill.js";
import type { OrderStore } from "../orders/ports.js";
import type { PolicyCheck, PolicyVerdict } from "../policy/check-policy.js";
import type { IntentStore } from "../ports.js";
import { checkFillForQueue, type FillQueueCheck, fillGrantOf } from "./fill-terms.js";
import { launchQuoteOf, recheckLaunch } from "./launch-queue-check.js";
import { type LaunchTargetParts, launchTargetsOf } from "./launch-targets.js";

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
  /**
   * Why a launch wallet's curve trade cannot sign: its launch's contracts could not be read now
   * (decision 0218). The intent ends with this reason, and nothing is signed.
   */
  readonly launchFailure?: LaunchReadFailure;
  /** Why an order's live fill ends at once, unsigned (decision 0211). */
  readonly refusal?: OrderFillReason;
}

/** The ports and steps the check reads. */
export interface QueueCheckParts extends ResolveOptions, LaunchTargetParts {
  readonly intents: IntentStore;
  /** The auto orders, whose fill grants a live fill signs under (decision 0210). */
  readonly orders: Pick<OrderStore, "get">;
  /** Whether live order fills may sign; off, the queue ends each one (decision 0211). */
  readonly liveFills: boolean;
  readonly policy: PolicyCheck;
  readonly clock: Clock;
  /** The venues' declarations, which name the contracts a trade's steps may reach. */
  readonly venues: readonly VenueDeclaration[];
}

interface Rechecked {
  readonly hasPassed: boolean;
  /** Why the policy refuses the intent now, when it gives a reason. */
  readonly reason?: OrderFillReason;
  readonly networkFeeCapNativeBase?: bigint;
}

// The policy runs again on the request and the confirmed quote, with the facts now of the wallet
// the intent was stored for, the intent's own outflow left out of the agent's (decision 0136): the
// trade the quote runs, its amount and place included, never a new share or place. An auto intent
// that now sells a denied token fails it: only a tap confirms that (decision 0101).
async function recheckPolicy(
  snapshot: IntentSnapshot,
  parts: QueueCheckParts,
  signal: AbortSignal,
): Promise<Rechecked> {
  const { record, settings, stored } = snapshot;
  if (record.kind === "launchToken") {
    return recheckLaunch(snapshot, parts, signal);
  }
  const request = { ...requestDocument.decode(record.request), wallet: record.walletId };
  const resolving = { request, settings, signal, intent: record.id };
  const resolved = await resolveProposal(parts, resolving);
  if (!resolved.ok || record.quote === undefined) {
    return { hasPassed: false, reason: "fill_failed" };
  }
  const { ask, facts, chain, nativeAsset, account } = resolved.value;
  const quote = quoteDocument.decode(record.quote);
  const swap = quotedTradeOf(ask, quote, {
    limits: settings.limits,
    account,
    chains: parts.chains,
  });
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
  const reason = refusalOf({ verdict, isAuto, holds: quoteHolds(quote, settings.limits) });
  const cap = { networkFeeCapNativeBase: facts.networkFeeCapNativeBase };
  return reason === undefined ? { hasPassed: true, ...cap } : { hasPassed: false, reason, ...cap };
}

// Why the policy refuses an intent now: its own reason, a denied token an auto intent sells, or a
// quote that no longer fits the agent's limits.
function refusalOf(check: {
  readonly verdict: PolicyVerdict;
  readonly isAuto: boolean;
  readonly holds: boolean;
}): OrderFillReason | undefined {
  const { verdict, isAuto, holds } = check;
  if (!verdict.ok) {
    return verdict.error;
  }
  if (isAuto && verdict.value.sellsDeniedToken) {
    return "token_denied";
  }
  return holds ? undefined : "price_impact";
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
 * The registry's set for the intent's steps: the contracts the venues of its quote's route, or a
 * token launch's launchpad (decision 0234), declare on the chain, read from the registry by name
 * as the ceiling reads them, which are also the spenders an approval may name, and the calls
 * those venues mark as a launch wallet's alone (decision 0271). A venue no declaration names, or
 * one that names a contract the registry lacks, adds none. A swap sends to no one.
 */
function allowedTargetsOf(
  snapshot: IntentSnapshot,
  context: { readonly chain: RegisteredChain; readonly venues: readonly VenueDeclaration[] },
): AllowedTargets {
  const { chain } = context;
  const launch = launchQuoteOf(snapshot.record);
  const quote =
    launch !== undefined || snapshot.record.quote === undefined
      ? undefined
      : quoteDocument.decode(snapshot.record.quote);
  const used = new Set(
    launch === undefined ? (quote?.route.map((leg) => leg.venue) ?? []) : [launch.venue],
  );
  const usedVenues = context.venues.filter((venue) => used.has(venue.id));
  const addresses = usedVenues.flatMap((venue) => {
    const declared = declaredContracts(venue, chain);
    return declared.ok ? declared.value : [];
  });
  const contracts: readonly AccountRef[] = [...new Set(addresses)].map((address) =>
    accountRefSchema.parse(`${chain.ref}:${address}`),
  );
  const launchOnlyCalls = usedVenues
    .flatMap((venue) => venue.contracts.filter((item) => item.chain === chain.ref))
    .flatMap((item) => (item.calls ?? []).filter((call) => call.isLaunchWalletOnly === true))
    .map((call) => call.abi);
  const marked = launchOnlyCalls.length === 0 ? {} : { launchOnlyCalls };
  return { contracts, spenders: contracts, recipients: [], ...marked };
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

// A tapped intent signs with the owner's confirmation, an auto one with its grant, an order's
// live fill with its fill grant, or ends at once with the reason it cannot (decision 0211).
async function termsOf(
  snapshot: IntentSnapshot,
  rechecked: Rechecked,
  context: { readonly parts: QueueCheckParts; readonly signal: AbortSignal },
): Promise<FillQueueCheck> {
  const { parts, signal } = context;
  const { authorizedBy } = snapshot.stored.status;
  if (authorizedBy === undefined) {
    const terms = await confirmationTerms(snapshot, parts, signal);
    return terms === undefined ? {} : { terms };
  }
  if (!isFillAuthorization(authorizedBy)) {
    const terms = autoTerms(snapshot, rechecked, parts.clock.now());
    return terms === undefined ? {} : { terms };
  }
  const isAgentLive = snapshot.settings.agent.mode === "live";
  const { reason, networkFeeCapNativeBase } = rechecked;
  return checkFillForQueue(parts, snapshot, {
    liveFills: parts.liveFills,
    isAgentLive,
    ...(reason === undefined ? {} : { policyReason: reason }),
    ...(networkFeeCapNativeBase === undefined ? {} : { networkFeeCapNativeBase }),
    signal,
  });
}

/**
 * What a live fill's later steps sign with after a restart (decision 0211): its fill grant as the
 * queue made it, whatever its order became, which each step checks again before it is signed;
 * `undefined` when the fill's stored terms no longer bind it.
 */
export async function recoveredFillTerms(
  snapshot: IntentSnapshot,
  context: { readonly parts: QueueCheckParts; readonly chain: RegisteredChain },
  signal: AbortSignal,
): Promise<SigningTerms | undefined> {
  const { parts, chain } = context;
  const rechecked = await recheckPolicy(snapshot, parts, signal);
  const networkFeeCapNativeBase = rechecked.networkFeeCapNativeBase ?? 0n;
  const granted = await fillGrantOf(parts, snapshot, { networkFeeCapNativeBase, signal });
  if (granted === undefined) {
    return undefined;
  }
  const { grant, current } = granted;
  const allowed = allowedTargetsOf(snapshot, { chain, venues: parts.venues });
  return { authorization: { kind: "order", grant, current }, termsHash: grant.termsHash, allowed };
}

/**
 * Reads what the wallet queue checks as it takes a confirmed intent (spec 6, `queue_took`): the
 * agent is live, the policy still passes, and the owner's confirmation, the auto grant or an
 * order fill's grant still holds; with it, what the signer checks for every step, a launch
 * wallet's launch contracts read again among them (decision 0217), and why a launch wallet's
 * curve trade cannot sign when its launch cannot be read now (decision 0218).
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
  const { terms, refusal } = await termsOf(snapshot, rechecked, { parts, signal });
  const facts: QueueFacts = {
    isAgentLive: snapshot.settings.agent.mode === "live",
    hasPolicyPassed: rechecked.hasPassed,
    ...(confirmation === undefined ? {} : { confirmation }),
    ...(authorizedBy === undefined ? {} : { isAuthorizationValid: terms !== undefined }),
  };
  const isAuto = authorizedBy !== undefined && !isFillAuthorization(authorizedBy);
  const registry = allowedTargetsOf(snapshot, { chain, venues: parts.venues });
  const launch = await launchTargetsOf(snapshot.record, parts, signal);
  const failure = launch.kind === "failed" ? { launchFailure: launch.reason } : {};
  const allowed = launch.kind === "read" ? { ...registry, launch: launch.launch } : registry;
  const signing = terms === undefined ? {} : { terms: { ...terms, allowed } };
  const refused = refusal === undefined ? {} : { refusal };
  return { facts, isAuto, ...failure, ...signing, ...refused };
}
