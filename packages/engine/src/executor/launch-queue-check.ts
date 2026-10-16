import { assetRefParts } from "@binference/chain";
import type { Clock } from "@binference/core";
import type { IntentSnapshot } from "../intents/create-stored-intents.js";
import { requestDocument } from "../intents/intent-documents.schema.js";
import type { IntentRecord } from "../intents/intent-record.js";
import { type TokenLaunchQuote, tokenLaunchQuoteDocument } from "../intents/token-launch-quote.js";
import { launchSubjectOf } from "../money-path/launch-policy.js";
import { policyFactsOf } from "../money-path/policy-facts-of.js";
import { nativeAssetOf, type ResolveOptions } from "../money-path/resolve-proposal.js";
import type { PolicyCheck } from "../policy/check-policy.js";

/** What the queue reads as it checks a token launch again (decision 0234). */
export interface LaunchRecheckParts extends Pick<ResolveOptions, "custody" | "wallets" | "chains"> {
  readonly policy: PolicyCheck;
  readonly clock: Clock;
}

/** A launch's quote, when the intent is a token launch that has one. */
export function launchQuoteOf(record: IntentRecord): TokenLaunchQuote | undefined {
  return record.kind === "launchToken" && record.quote !== undefined
    ? tokenLaunchQuoteDocument.decode(record.quote)
    : undefined;
}

/**
 * The policy run again on a confirmed token launch as the wallet queue takes it (decision 0234):
 * its first buy and its confirmed fee, from the wallet it was stored for, with that wallet's facts
 * now and the launch's own outflow left out of the agent's. A launch the wallet's account or the
 * chain no longer gives is not passed.
 */
export async function recheckLaunch(
  snapshot: IntentSnapshot,
  parts: LaunchRecheckParts,
  signal: AbortSignal,
): Promise<{ readonly hasPassed: boolean; readonly networkFeeCapNativeBase?: bigint }> {
  const { record, settings, stored } = snapshot;
  const request = requestDocument.decode(record.request);
  const quote = launchQuoteOf(record);
  const chain =
    request.kind === "launchToken"
      ? parts.chains.get(assetRefParts(request.pairWith).chain)
      : undefined;
  if (request.kind !== "launchToken" || quote === undefined || chain?.ok !== true) {
    return { hasPassed: false };
  }
  const account = await parts.custody.account(record.walletId, chain.value.ref, { signal });
  if (!account.ok) {
    return { hasPassed: false };
  }
  const query = {
    agent: record.agentId,
    wallet: record.walletId,
    account: account.value,
    isPaper: false,
    intent: record.id,
  };
  const facts = await parts.wallets.facts(query, { signal });
  const policyFacts = policyFactsOf({
    settings,
    wallet: facts,
    chain: chain.value.ref,
    chains: parts.chains,
    nativeAsset: nativeAssetOf(chain.value),
    nowMs: parts.clock.now(),
  });
  const subject = launchSubjectOf(request, quote.fee, stored.status);
  const verdict = await parts.policy.check(subject, policyFacts, { signal });
  return { hasPassed: verdict.ok, networkFeeCapNativeBase: facts.networkFeeCapNativeBase };
}
