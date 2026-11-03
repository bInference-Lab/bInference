import type { IdentityRecord } from "../identity/identity-record.js";
import type { IntentSnapshot } from "../intents/create-stored-intents.js";
import type { IdentityQuote } from "../intents/identity-quote.js";
import type { DepartureDraft } from "../positions/departure-record.js";
import { noticePush } from "../pushes/notice-push.js";
import { type ExecutionRun, moveIntent, nextBlock } from "./executor-run.js";
import { type LandedStep, reconcileDepartures } from "./reconcile-departures.js";

/** The owner's notice of a registration the registry does not read back as its card (decision 0335). */
const mismatchNoticeKey = "notice.identityMismatch";

// What the registration's landed step read back: the identity to store, `mismatch` when the
// registry holds another holder or file than the card, or `undefined` while it cannot be read.
async function readBack(
  run: ExecutionRun,
  quote: IdentityQuote,
  step: LandedStep,
): Promise<Omit<IdentityRecord, "agentId" | "registeredAtMs"> | "mismatch" | undefined> {
  const host = run.parts.identity;
  const registry = host?.registryOn(run.plan.chain.ref);
  if (host === undefined || registry?.id !== quote.venue) {
    return undefined;
  }
  const request = { wallet: quote.wallet, txHash: step.txHash };
  const read = await host.landed(registry, request, { signal: run.signal });
  if (!read.ok) {
    return read.error === "not_found" ? "mismatch" : undefined;
  }
  const { onchainId, owner, file } = read.value;
  return owner === quote.wallet && file === quote.file
    ? { chain: run.plan.chain.ref, registry: quote.registry, onchainId, txHash: step.txHash, file }
    : "mismatch";
}

// A registration the registry does not read back as its card stores no identity: it reconciles,
// and the owner is told.
async function settleMismatch(run: ExecutionRun, finalized: IntentSnapshot): Promise<void> {
  const { id, agentId } = finalized.record;
  run.parts.log.warn("executor.identity_mismatch", { intentId: id });
  const moved = await moveIntent(run, finalized, { type: "fills_reconciled" });
  if (moved !== undefined) {
    const values = { agent: finalized.settings.agent.name };
    run.parts.publish(noticePush({ key: mismatchNoticeKey, agent: agentId, intent: id, values }));
  }
}

// Reads the registration back, again each block while the registry cannot answer, up to
// `settleAfterBlocks`; then it stays `finalized`, and recovery reads it again after a restart.
async function settleRegistration(
  run: ExecutionRun,
  settling: {
    readonly finalized: IntentSnapshot;
    readonly quote: IdentityQuote;
    readonly step: LandedStep | undefined;
  },
  attempt = 0,
): Promise<void> {
  const { finalized, quote, step } = settling;
  const read = step === undefined ? "mismatch" : await readBack(run, quote, step);
  if (read === "mismatch") {
    await settleMismatch(run, finalized);
    return;
  }
  if (read !== undefined) {
    const { agentId, changedAtMs } = finalized.record;
    const identity = { ...read, agentId, registeredAtMs: changedAtMs };
    const trigger = { type: "fills_reconciled" } as const;
    await moveIntent(run, finalized, { trigger, identity, named: { identityId: read.onchainId } });
    return;
  }
  if (attempt >= run.parts.limits.settleAfterBlocks) {
    run.parts.log.warn("executor.settle_late", { intentId: finalized.record.id });
    return;
  }
  await nextBlock(run);
  await settleRegistration(run, settling, attempt + 1);
}

/**
 * What a registration's landed steps took out of its wallet: their gas alone, which leaves the
 * coin's position as what it sent, as an approval revoke's does (decision 0309).
 */
export function gasDepartures(
  snapshot: IntentSnapshot,
  landed: readonly LandedStep[],
): readonly DepartureDraft[] {
  const { walletId, changedAtMs: atMs } = snapshot.record;
  return landed.map(({ gas, txHash }) => ({
    walletId,
    atMs,
    sent: gas,
    gas: { asset: gas.asset, base: 0n },
    txHash,
  }));
}

/**
 * Reconciles a finalized identity registration (decision 0335): its gas leaves the wallet as a
 * departure, as an approval revoke's does, then the registry reads the registration back from its
 * transaction. The id its `Registered` event gave, held by the card's wallet with the card's file,
 * is stored with the move to `reconciled`, which names the id for the receipt; a registration the
 * registry reads back otherwise stores no identity, reconciles, and the owner gets
 * `notice.identityMismatch`.
 */
export async function reconcileIdentity(
  run: ExecutionRun,
  finalized: IntentSnapshot,
  quote: IdentityQuote,
): Promise<void> {
  await reconcileDepartures(run, {
    finalized,
    departuresOf: (landed) => gasDepartures(finalized, landed),
    departed: async (landed) => settleRegistration(run, { finalized, quote, step: landed.at(-1) }),
  });
}
