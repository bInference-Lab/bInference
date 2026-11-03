import {
  type AccountRef,
  type AllowedTargets,
  accountRefParts,
  accountRefSchema,
  declaredContracts,
  type RegisteredChain,
  type VenueDeclaration,
} from "@binference/chain";
import type { IdentityRegistry, IdentityStanding } from "@binference/chain/identity";
import type { IdentityHost } from "../identity/identity-host.js";
import { hasRegistrationIn, sentRegistrationStates } from "../identity/open-registrations.js";
import type { IntentSnapshot } from "../intents/create-stored-intents.js";
import { type IdentityQuote, identityQuoteDocument } from "../intents/identity-quote.js";
import { planDocument } from "../intents/intent-documents.schema.js";
import type { IntentRecord } from "../intents/intent-record.js";
import { nativeAssetOf } from "../money-path/resolve-proposal.js";
import { checkTransferPolicy } from "../sends/check-transfer-policy.js";
import { declaredTargetsOf } from "./declared-calls.js";
import { type ExecutionRun, moveIntent } from "./executor-run.js";
import type { TransferRecheckParts } from "./transfer-queue-check.js";

/** An identity registration's quote, when the intent is one that has one. */
export function identityQuoteOf(record: IntentRecord): IdentityQuote | undefined {
  return record.kind === "registerIdentity" && record.quote !== undefined
    ? identityQuoteDocument.decode(record.quote)
    : undefined;
}

/**
 * What the signer may let a registration's one call reach (spec 5, section 5.2): the registry its
 * plugin declares on the chain, read from the chain registry by name, and only the function it
 * declares there; no recipient and no spender, since a registration pays no one and approves
 * nothing. A registry the engine does not run gives no contract, so nothing signs.
 */
export function identityTargetsOf(
  quote: IdentityQuote,
  context: {
    readonly chain: RegisteredChain;
    readonly venues: readonly VenueDeclaration[];
    readonly identity?: IdentityHost;
  },
): AllowedTargets {
  const { chain, venues, identity } = context;
  const registry = identity?.registryOn(chain.ref);
  const used: readonly VenueDeclaration[] =
    registry === undefined || registry.id !== quote.venue ? [] : [registry];
  const declared = used.flatMap((venue) => {
    const found = declaredContracts(venue, chain);
    return found.ok ? found.value : [];
  });
  const contracts: readonly AccountRef[] = declared.map((address) =>
    accountRefSchema.parse(`${chain.ref}:${address}`),
  );
  const targets = declaredTargetsOf(chain, { used, all: [...venues, ...used] });
  return { contracts, spenders: [], recipients: [], ...targets };
}

/** What the queue reads as it checks a registration again. */
export interface IdentityRecheckParts extends TransferRecheckParts {
  readonly identity?: IdentityHost;
}

/**
 * The policy run again on a confirmed registration as the wallet queue takes it (spec 6,
 * `queue_took`): the agent live and not frozen, with the wallet's facts now. No venue rule judges
 * it, as at its proposal: the owner's opt-in is the ceiling's call (decision 0335). A registry the
 * engine no longer runs is not passed.
 */
export async function recheckIdentity(
  snapshot: IntentSnapshot,
  parts: IdentityRecheckParts,
  signal: AbortSignal,
): Promise<{ readonly hasPassed: boolean; readonly networkFeeCapNativeBase?: bigint }> {
  const { record, settings, stored } = snapshot;
  const quote = identityQuoteOf(record);
  const chain =
    quote === undefined ? undefined : parts.chains.get(accountRefParts(quote.wallet).chain);
  if (quote === undefined || chain?.ok !== true) {
    return { hasPassed: false };
  }
  const query = { agent: record.agentId, wallet: record.walletId, account: quote.wallet };
  const facts = await parts.wallets.facts(
    { ...query, isPaper: false, intent: record.id },
    { signal },
  );
  const judged = {
    status: stored.status,
    settings,
    facts,
    chain: chain.value,
    nativeAsset: nativeAssetOf(chain.value),
  };
  const verdict = await checkTransferPolicy(parts, judged, signal);
  return { hasPassed: verdict.ok, networkFeeCapNativeBase: facts.networkFeeCapNativeBase };
}

/**
 * What the queue does with a confirmed intent after a registration was read again: sign it (`go`,
 * also for any intent that is no registration), wait for the next block because the registry did
 * not answer (`unread`), or nothing more, since it ended (`ended`).
 */
export type IdentityTake = "go" | "unread" | "ended";

async function endRefused(
  run: ExecutionRun,
  snapshot: IntentSnapshot,
  reason: "identity_exists" | "registry_changed" | "decode_mismatch",
): Promise<IdentityTake> {
  await moveIntent(run, snapshot, { type: "identity_refused", reason });
  run.parts.log.warn("executor.identity_refused", {
    intentId: snapshot.record.id,
    errorCode: reason,
  });
  return "ended";
}

// The registry the card named, as the engine runs it on the run's chain, with what it reads now
// for the card's wallet; `undefined` while it cannot be read or the engine does not run it.
async function readNow(
  run: ExecutionRun,
  quote: IdentityQuote,
): Promise<
  | {
      readonly host: IdentityHost;
      readonly registry: IdentityRegistry;
      readonly standing: IdentityStanding;
    }
  | undefined
> {
  const host = run.parts.identity;
  const registry = host?.registryOn(run.plan.chain.ref);
  if (host === undefined || registry?.id !== quote.venue) {
    return undefined;
  }
  const standing = await host.standing(registry, quote.wallet, { signal: run.signal });
  return standing.ok ? { host, registry, standing: standing.value } : undefined;
}

// Why the registration cannot sign now, or `undefined` when it may.
function refusalOf(
  snapshot: IntentSnapshot,
  quote: IdentityQuote,
  read: NonNullable<Awaited<ReturnType<typeof readNow>>>,
): "identity_exists" | "registry_changed" | "decode_mismatch" | undefined {
  const { host, registry, standing } = read;
  if (standing.held > 0n) {
    return "identity_exists";
  }
  if (standing.version !== registry.testedVersion) {
    return "registry_changed";
  }
  const { plan } = snapshot.record;
  const steps = plan === undefined ? [] : planDocument.decode(plan);
  const [draft] = steps;
  const request = { wallet: quote.wallet, file: quote.file };
  return draft !== undefined && steps.length === 1 && host.holds(registry, draft, request)
    ? undefined
    : "decode_mismatch";
}

/**
 * Reads a confirmed registration's registry again as its wallet's queue takes it, before any
 * signature (decision 0335): another registration of the agent that is signed and on its way, or a
 * wallet that holds an identity now, ends it `failed_check` with `identity_exists`, a registry that reports another version than binference was tested with with
 * `registry_changed`, and a stored call that no longer decodes as the card's file from its wallet
 * with `decode_mismatch`; a registry that does not answer, or one the engine does not run, signs
 * nothing and waits for the next block. Any other intent goes on.
 */
export async function takeIdentity(
  run: ExecutionRun,
  snapshot: IntentSnapshot,
): Promise<IdentityTake> {
  const quote = identityQuoteOf(snapshot.record);
  if (quote === undefined) {
    return "go";
  }
  const { id, agentId } = snapshot.record;
  const sent = { agent: agentId, states: sentRegistrationStates, except: id };
  if (await hasRegistrationIn(run.parts.intents, sent, run.signal)) {
    return endRefused(run, snapshot, "identity_exists");
  }
  const read = await readNow(run, quote);
  if (read === undefined) {
    run.parts.log.warn("executor.identity_unread", { intentId: snapshot.record.id });
    return "unread";
  }
  const refusal = refusalOf(snapshot, quote, read);
  return refusal === undefined ? "go" : endRefused(run, snapshot, refusal);
}
