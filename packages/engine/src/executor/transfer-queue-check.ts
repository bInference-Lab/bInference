import {
  type AccountRef,
  type AllowedTargets,
  type Amount,
  assetRefParts,
  type ChainRegistry,
  type RegisteredChain,
  type Signer,
  type VenueDeclaration,
} from "@binference/chain";
import type { Clock } from "@binference/core";
import type { IntentSnapshot } from "../intents/create-stored-intents.js";
import type { IntentRecord } from "../intents/intent-record.js";
import { type RevokeQuote, revokeQuoteDocument } from "../intents/revoke-quote.js";
import { type SendQuote, sendQuoteDocument } from "../intents/send-quote.js";
import { nativeAssetOf } from "../money-path/resolve-proposal.js";
import { isRegistryContract } from "../operations/is-registry-contract.js";
import type { PolicyCheck } from "../policy/check-policy.js";
import { rescueAt } from "../policy/rescue-change.js";
import type { InstallStore, WalletFactsSource } from "../ports.js";
import { checkTransferPolicy } from "../sends/check-transfer-policy.js";
import { declaredTargetsOf } from "./declared-calls.js";

/** A send's or a revoke's quote, as its card confirmed it. */
export type TransferQuote =
  | { readonly kind: "send"; readonly quote: SendQuote }
  | { readonly kind: "revokeApproval"; readonly quote: RevokeQuote };

/** A send's or a revoke's quote, when the intent is one that has one. */
export function transferQuoteOf(record: IntentRecord): TransferQuote | undefined {
  const { kind, quote } = record;
  if (quote === undefined) {
    return undefined;
  }
  if (kind === "send") {
    return { kind, quote: sendQuoteDocument.decode(quote) };
  }
  return kind === "revokeApproval" ? { kind, quote: revokeQuoteDocument.decode(quote) } : undefined;
}

// The asset whose chain the step runs on: what a send moves, or the token a revoke frees.
function movedAsset(transfer: TransferQuote): Amount["asset"] {
  return transfer.kind === "send" ? transfer.quote.amount.asset : transfer.quote.token;
}

/**
 * What the signer may let a send's or a revoke's one step reach (spec 5, section 5.2): a send pays
 * only the address its card confirmed, and a revoke approves only the spender its card named, when
 * the chain registry lists it (decision 0309), with no contract; the contracts no approval goes to
 * and the spenders of one role from every venue's declaration still hold.
 */
export function transferTargetsOf(
  transfer: TransferQuote,
  context: {
    readonly chain: RegisteredChain;
    readonly chains: ChainRegistry;
    readonly venues: readonly VenueDeclaration[];
  },
): AllowedTargets {
  const { chain, chains, venues } = context;
  const declared = declaredTargetsOf(chain, { used: venues, all: venues });
  if (transfer.kind === "send") {
    return { contracts: [], spenders: [], recipients: [transfer.quote.recipient], ...declared };
  }
  const { spender } = transfer.quote;
  const spenders: readonly AccountRef[] = isRegistryContract(spender, chains) ? [spender] : [];
  return { contracts: [], spenders, recipients: [], ...declared };
}

/** What the queue reads as it checks a send or a revoke again. */
export interface TransferRecheckParts {
  readonly custody: Signer;
  readonly wallets: WalletFactsSource;
  readonly chains: ChainRegistry;
  readonly policy: PolicyCheck;
  readonly clock: Clock;
  /** The install, whose rescue address in effect a send may pay; none is in effect without it. */
  readonly stores?: { readonly install: Pick<InstallStore, "read"> };
}

/**
 * The policy run again on a confirmed send or revoke as the wallet queue takes it (spec 6,
 * `queue_took`): the amount and target its card confirmed, from the wallet it was stored for, with
 * that wallet's facts now, its own outflow left out of the agent's, the send level and the address
 * book now, and the rescue address in effect now. One the wallet's account or the chain no longer
 * gives is not passed.
 */
export async function recheckTransfer(
  snapshot: IntentSnapshot,
  parts: TransferRecheckParts,
  signal: AbortSignal,
): Promise<{ readonly hasPassed: boolean; readonly networkFeeCapNativeBase?: bigint }> {
  const { record, settings, stored } = snapshot;
  const held = await heldTransferOf(record, parts, signal);
  if (held === undefined) {
    return { hasPassed: false };
  }
  const { transfer, chain, account } = held;
  const query = { agent: record.agentId, wallet: record.walletId, account };
  const facts = await parts.wallets.facts(
    { ...query, isPaper: false, intent: record.id },
    { signal },
  );
  const install = await parts.stores?.install.read({ signal });
  const rescue =
    install === undefined ? undefined : rescueAt(install, parts.clock.now()).rescueAddress;
  const sent = transfer.kind === "send" ? transfer.quote : undefined;
  const judged = {
    status: stored.status,
    settings,
    facts,
    chain,
    nativeAsset: nativeAssetOf(chain),
    ...(rescue === undefined ? {} : { rescueAccount: rescue }),
    ...(sent === undefined ? {} : { outflow: sent.amount, target: sent.recipient }),
  };
  const verdict = await checkTransferPolicy(parts, judged, signal);
  return { hasPassed: verdict.ok, networkFeeCapNativeBase: facts.networkFeeCapNativeBase };
}

// The send's or revoke's quote, its chain and the wallet's account there; none when the intent has
// no such quote, or the registry or the custodian no longer gives them.
async function heldTransferOf(
  record: IntentRecord,
  parts: TransferRecheckParts,
  signal: AbortSignal,
): Promise<
  | {
      readonly transfer: TransferQuote;
      readonly chain: RegisteredChain;
      readonly account: AccountRef;
    }
  | undefined
> {
  const transfer = transferQuoteOf(record);
  const chain =
    transfer === undefined
      ? undefined
      : parts.chains.get(assetRefParts(movedAsset(transfer)).chain);
  if (transfer === undefined || chain?.ok !== true) {
    return undefined;
  }
  const account = await parts.custody.account(record.walletId, chain.value.ref, { signal });
  return account.ok ? { transfer, chain: chain.value, account: account.value } : undefined;
}
