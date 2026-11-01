import {
  type AccountRef,
  type DecodedDeposit,
  decodedDepositSchema,
  isSameAccount,
  type TxDraft,
} from "@binference/chain";
import { type Clock, err, ok, type Result } from "@binference/core";
import type { BridgeIntentQuote } from "../intents/bridge-quote.js";
import type { QuoteFailure } from "../intents/intent-reason.js";
import { callVenue, ownCopy } from "../venues/call-venue.js";
import { bridgeContractsOn, type ChosenBridge } from "./choose-bridge.js";
import { isDepositAsPlanned } from "./deposit-checks.js";
import type { ResolvedBridge } from "./resolve-bridge.js";

/** A bridge's plan and the quote its card confirms. */
export interface BuiltBridge {
  readonly steps: readonly TxDraft[];
  readonly quote: BridgeIntentQuote;
}

// A bridge builds within this, or counts as down.
const buildTimeoutMs = 10_000;

// Every step leaves the wallet on the source chain; each before the last is an exact approval of
// the amount sent, to one of the bridge's spenders, and the last is its one deposit.
function depositOf(
  bridge: ResolvedBridge,
  chosen: ChosenBridge,
  steps: readonly TxDraft[],
): DecodedDeposit | undefined {
  const { family } = bridge.chain;
  const spenders = Object.values(chosen.request.contracts);
  const isOwn = steps.every(
    (step) => step.chain === bridge.chain.ref && isSameAccount(step.from, bridge.account, family),
  );
  const approvals = steps.slice(0, -1).every((step) => {
    const approval = family.readDraft(step);
    const granted = approval.ok ? approval.value.approval : undefined;
    return (
      granted !== undefined &&
      granted.asset === bridge.amount.asset &&
      granted.amountBase === bridge.amount.base &&
      spenders.some((spender) => isSameAccount(spender, granted.spender, family))
    );
  });
  const last = steps.at(-1);
  const decoded = last === undefined ? undefined : chosen.candidate.hosted.bridge.decode(last);
  const deposit = decoded?.ok === true ? ownCopy(decodedDepositSchema, decoded.value) : undefined;
  return isOwn && approvals ? deposit : undefined;
}

function quoteOf(
  bridge: ResolvedBridge,
  chosen: ChosenBridge,
  deposit: {
    readonly kind: DecodedDeposit["kind"];
    readonly contract: AccountRef;
    readonly destinationId: string;
  },
): BridgeIntentQuote {
  const { payee, amount } = bridge;
  const { quote, candidate } = chosen;
  return {
    venue: candidate.hosted.bridge.id,
    chainName: bridge.destination.name,
    amount,
    recipient: payee.account,
    recipientBytes: payee.recipientBytes,
    ...(payee.label === undefined ? {} : { label: payee.label }),
    ...(payee.rescueHome === undefined ? {} : { isRescue: true }),
    expectedOut: quote.expectedOut,
    minOut: quote.minOut,
    ...(quote.deliveredAsCoin === undefined ? {} : { deliveredAsCoin: quote.deliveredAsCoin }),
    fees: quote.fees,
    ...(chosen.swapRateBps === undefined ? {} : { swapRateBps: chosen.swapRateBps }),
    etaSeconds: quote.etaSeconds,
    quotedAtMs: quote.quotedAtMs,
    expiresAtMs: quote.expiresAtMs,
    deposit,
  };
}

/**
 * Builds the chosen route's steps and holds them to the plan (decisions 0317 and 0319): exact
 * approvals of the amount sent to the bridge's spenders, then one deposit that decodes back to the
 * payee, the amount, the route's token, at least the quote's least output and the venue's
 * declared contract, for a destination the bridge declares. A build that throws or runs past 10
 * seconds is `venue_down`; anything else that differs is `decode_mismatch`.
 */
export async function buildBridge(
  parts: { readonly clock: Clock },
  bridge: ResolvedBridge,
  call: { readonly chosen: ChosenBridge; readonly signal: AbortSignal },
): Promise<Result<BuiltBridge, QuoteFailure>> {
  const { chosen, signal } = call;
  const { bridge: venue } = chosen.candidate.hosted;
  const request = { ...chosen.request, quote: chosen.quote, minOut: chosen.quote.minOut };
  const timing = { clock: parts.clock, signal, timeoutMs: buildTimeoutMs };
  const built = await callVenue(async (inner) => venue.build(request, { signal: inner }), timing);
  if (!built.ok) {
    return built;
  }
  const steps = [...built.value];
  const contracts = Object.values(bridgeContractsOn(chosen.candidate, bridge.chain));
  const deposit = depositOf(bridge, chosen, steps);
  const destination = venue.destinations.find((item) => item.chain === bridge.destination.ref);
  if (
    deposit === undefined ||
    destination === undefined ||
    !isDepositAsPlanned(deposit, bridge, { ...chosen, contracts })
  ) {
    return err("decode_mismatch");
  }
  const terms = { kind: deposit.kind, contract: deposit.contract, destinationId: destination.id };
  return ok({ steps, quote: quoteOf(bridge, chosen, terms) });
}
