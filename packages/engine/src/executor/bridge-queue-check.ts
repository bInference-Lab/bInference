import {
  type AccountCodeReader,
  type AccountRef,
  accountRefParts,
  type AllowedTargets,
  accountRefSchema,
  type AssetRef,
  assetRefParts,
  type CallInputCheck,
  type ChainRegistry,
  declaredContracts,
  type RegisteredChain,
  type VenueDeclaration,
} from "@binference/chain";
import type { Clock } from "@binference/core";
import type { DestinationChain } from "../address-book/destination-chain.js";
import { isPlainOnBoth } from "../bridges/bridge-checks.js";
import { isSignerAddress } from "../bridges/deposit-checks.js";
import { type BridgeIntentQuote, bridgeQuoteDocument } from "../intents/bridge-quote.js";
import type { IntentSnapshot } from "../intents/create-stored-intents.js";
import type { IntentRecord } from "../intents/intent-record.js";
import { nativeAssetOf } from "../money-path/resolve-proposal.js";
import { rescueAt } from "../policy/rescue-change.js";
import { checkTransferPolicy } from "../sends/check-transfer-policy.js";
import { declaredTargetsOf } from "./declared-calls.js";
import type { TransferRecheckParts } from "./transfer-queue-check.js";

/**
 * What the executor bridges with: the bridges' declarations, which name a deposit's contracts and
 * bound inputs, the chains they deliver to, with their code readers, and the code readers of the
 * wallets' chains (decision 0318).
 */
export interface ExecutorBridging {
  readonly bridges: readonly VenueDeclaration[];
  readonly destinations: readonly DestinationChain[];
  readonly codeReaders: readonly AccountCodeReader[];
}

/** A bridge's quote, when the intent is a bridge that has one. */
export function bridgeQuoteOf(record: IntentRecord): BridgeIntentQuote | undefined {
  return record.kind === "bridge" && record.quote !== undefined
    ? bridgeQuoteDocument.decode(record.quote)
    : undefined;
}

// A token's contract as the signer compares an address input, from its asset; none for an asset
// with no 20-byte contract, such as a chain's coin.
function tokenAddressOf(asset: AssetRef): string | undefined {
  const reference = assetRefParts(asset).assetReference.toLowerCase();
  return isSignerAddress(reference) ? reference : undefined;
}

// A bridge deposit's check filled from the confirmed plan (decision 0317): its recipient,
// destination chain, both tokens and, when the venue names it, the amount sent equal, its least
// output at least the plan's, on the inputs the venue declared. A recipient or token with no
// 20-byte form leaves the check unfilled, so the signer refuses the deposit.
function filled(check: CallInputCheck, quote: BridgeIntentQuote): CallInputCheck {
  const { bridge } = check;
  const tokenIn = tokenAddressOf(quote.amount.asset);
  const tokenOut = tokenAddressOf(quote.minOut.asset);
  if (
    bridge === undefined ||
    !isSignerAddress(quote.recipientBytes) ||
    tokenIn === undefined ||
    tokenOut === undefined
  ) {
    return check;
  }
  const amount =
    bridge.amountIn === undefined ? {} : { [bridge.amountIn]: quote.amount.base.toString() };
  return {
    ...check,
    equal: {
      ...check.equal,
      [bridge.recipient]: quote.recipientBytes,
      [bridge.destinationChain]: quote.deposit.destinationId,
      [bridge.tokenIn]: tokenIn,
      [bridge.tokenOut]: tokenOut,
      ...amount,
    },
    atLeast: { ...check.atLeast, [bridge.minOut]: quote.minOut.base.toString() },
  };
}

/**
 * What the signer may let a confirmed bridge's steps reach (keys spec, section 5.2; decisions
 * 0302 and 0317): the contracts its venue declares on the chain, which are also the spenders an
 * approval may name, the declared calls, the inputs pinned to the wallet or kept empty, and the
 * deposit's recipient, destination chain and least output filled from the card's plan. It pays no
 * account directly.
 */
export function bridgeTargetsOf(
  quote: BridgeIntentQuote,
  context: {
    readonly chain: RegisteredChain;
    readonly venues: readonly VenueDeclaration[];
    readonly bridges: readonly VenueDeclaration[];
  },
): AllowedTargets {
  const { chain, venues, bridges } = context;
  const used = bridges.filter((bridge) => bridge.id === quote.venue);
  const addresses = used.flatMap((bridge) => {
    const declared = declaredContracts(bridge, chain);
    return declared.ok ? declared.value : [];
  });
  const contracts: readonly AccountRef[] = [...new Set(addresses)].map((address) =>
    accountRefSchema.parse(`${chain.ref}:${address}`),
  );
  const declared = declaredTargetsOf(chain, { used, all: [...venues, ...bridges] });
  const callInputs = declared.callInputs?.map((check) => filled(check, quote));
  return {
    contracts,
    spenders: contracts,
    recipients: [],
    ...declared,
    ...(callInputs === undefined ? {} : { callInputs }),
  };
}

/** What the queue reads as it checks a bridge again. */
export interface BridgeRecheckParts extends TransferRecheckParts {
  readonly bridging?: ExecutorBridging;
  readonly chains: ChainRegistry;
  readonly clock: Clock;
}

// The rescue address still holds no code on its own chain and none on the destination (decision
// 0318); a chain with no reader, or a read that fails, does not pass.
async function isStillPlain(
  parts: BridgeRecheckParts,
  rescue: { readonly home: AccountRef; readonly there: AccountRef },
  signal: AbortSignal,
): Promise<boolean> {
  const { home, there } = rescue;
  const here = parts.bridging?.codeReaders.find(
    (reader) => reader.chain === accountRefParts(home).chain,
  );
  const codes = parts.bridging?.destinations.find(
    (item) => item.ref === accountRefParts(there).chain,
  )?.codes;
  const readers = {
    ...(here === undefined ? {} : { here }),
    ...(codes === undefined ? {} : { there: codes }),
  };
  try {
    return await isPlainOnBoth(readers, rescue, signal);
  } catch {
    signal.throwIfAborted();
    return false;
  }
}

// The rescue address in effect, when it still is the bridge's payee on the destination.
async function rescueHomeOf(
  parts: BridgeRecheckParts,
  quote: BridgeIntentQuote,
  signal: AbortSignal,
): Promise<AccountRef | undefined> {
  const install = await parts.stores?.install.read({ signal });
  const home =
    install === undefined ? undefined : rescueAt(install, parts.clock.now()).rescueAddress;
  return home !== undefined && accountRefParts(home).address.toLowerCase() === quote.recipientBytes
    ? home
    : undefined;
}

// A bridge to the rescue address still pays the rescue address in effect, which still holds no
// code on either chain; a bridge to an entry the policy judges alone.
async function rescueHolds(
  parts: BridgeRecheckParts,
  quote: BridgeIntentQuote,
  signal: AbortSignal,
): Promise<{ readonly holds: boolean; readonly home?: AccountRef }> {
  if (quote.isRescue !== true) {
    return { holds: true };
  }
  const home = await rescueHomeOf(parts, quote, signal);
  if (home === undefined) {
    return { holds: false };
  }
  return { holds: await isStillPlain(parts, { home, there: quote.recipient }, signal), home };
}

// The bridge's quote, its chain and the wallet's account there, while its quote has not expired by
// the engine's clock; none otherwise.
async function heldBridgeOf(
  record: IntentRecord,
  parts: BridgeRecheckParts,
  signal: AbortSignal,
): Promise<
  | {
      readonly quote: BridgeIntentQuote;
      readonly chain: RegisteredChain;
      readonly account: AccountRef;
    }
  | undefined
> {
  const quote = bridgeQuoteOf(record);
  const chain =
    quote === undefined ? undefined : parts.chains.get(assetRefParts(quote.amount.asset).chain);
  if (quote === undefined || chain?.ok !== true || parts.clock.now() >= quote.expiresAtMs) {
    return undefined;
  }
  const account = await parts.custody.account(record.walletId, chain.value.ref, { signal });
  return account.ok ? { quote, chain: chain.value, account: account.value } : undefined;
}

/**
 * The checks of a confirmed bridge as the wallet queue takes it (spec 6, `queue_took`; decisions
 * 0318 and 0319): its quote has not expired by the engine's clock; the policy passes again on the
 * amount and payee its card confirmed, with the wallet's facts, the send level and the address
 * book now; and a bridge to the rescue address still pays the rescue address in effect, which
 * still holds no code on either chain. Any that fails leaves it unsigned, and the queue tries
 * again a block later until its confirmation runs out.
 */
export async function recheckBridge(
  snapshot: IntentSnapshot,
  parts: BridgeRecheckParts,
  signal: AbortSignal,
): Promise<{ readonly hasPassed: boolean; readonly networkFeeCapNativeBase?: bigint }> {
  const { record, settings, stored } = snapshot;
  const held = await heldBridgeOf(record, parts, signal);
  if (held === undefined) {
    return { hasPassed: false };
  }
  const { quote, chain, account } = held;
  const query = { agent: record.agentId, wallet: record.walletId, account, intent: record.id };
  const facts = await parts.wallets.facts({ ...query, isPaper: false }, { signal });
  const rescue = await rescueHolds(parts, quote, signal);
  const judged = {
    status: stored.status,
    settings,
    facts,
    chain,
    nativeAsset: nativeAssetOf(chain),
    outflow: quote.amount,
    target: quote.recipient,
    venue: quote.venue,
    ...(rescue.home === undefined ? {} : { rescueAccount: quote.recipient }),
  };
  const verdict = await checkTransferPolicy(parts, judged, signal);
  return {
    hasPassed: verdict.ok && rescue.holds,
    networkFeeCapNativeBase: facts.networkFeeCapNativeBase,
  };
}
