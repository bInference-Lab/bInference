import { accountRefParts, type ChainRegistry, type TxDraft } from "@binference/chain";
import { addressPartOf, shortAddress } from "@binference/i18n";
import { isFillAuthorization } from "../intents/authorization.js";
import { everyIntentOf } from "../intents/every-intent.js";
import { authorizationDocument, planDocument } from "../intents/intent-documents.schema.js";
import type { IntentRecord } from "../intents/intent-record.js";
import { intentAssetInfos } from "../money-path/asset-infos.js";
import type { IntentStore, TransactionStore } from "../ports.js";
import type { EnginePush } from "../pushes/engine-push.js";
import { noticePush } from "../pushes/notice-push.js";

// The message key of the notice of an approval a fill left while the breaker held (0441).
const breakerApprovalLeftKey = "notice.breakerApprovalLeft";

/** What the lift reads to find the approvals fills left standing. */
export interface BreakerApprovalParts {
  readonly intents: IntentStore;
  readonly transactions: TransactionStore;
  readonly chains: ChainRegistry;
}

// The ended intents one read takes; the lift reads them all, a page at a time.
const pageSize = 500;

// A live order's or rule's fill the signer service refused as locked. The stored reason names no
// lock, so a key check's or a Privy app's lock in the same window counts too.
function isLockedFill(record: IntentRecord): boolean {
  const { authorizedBy, reason } = record;
  return (
    reason === "signer_locked" &&
    authorizedBy !== undefined &&
    isFillAuthorization(authorizationDocument.decode(authorizedBy))
  );
}

// The notice of the approval a landed step of the plan gave: the wallet and the spender as a card
// shows an address, and the allowance as an amount of its token, an unlisted one by what it
// answered at the proposal.
function approvalNotice(chains: ChainRegistry, draft: TxDraft, record: IntentRecord) {
  const chain = chains.get(draft.chain);
  const read = chain.ok ? chain.value.family.readDraft(draft) : undefined;
  const approval = read?.ok === true ? read.value.approval : undefined;
  if (approval === undefined) {
    return [];
  }
  const wallet = shortAddress(accountRefParts(draft.from).address);
  const spender = shortAddress(addressPartOf(approval.spender));
  const approved = { asset: approval.asset, base: approval.amountBase };
  const assets = intentAssetInfos(chains, record, [approval.asset]);
  const notice = { key: breakerApprovalLeftKey, agent: record.agentId, intent: record.id };
  const parts = { values: { wallet, spender }, amounts: { approved }, assets };
  return [noticePush({ ...notice, ...parts })];
}

// The approvals one ended intent left: each step stored before the one the service refused
// landed, since a step is signed only once a block holds the one before it.
async function approvalsOf(
  parts: BreakerApprovalParts,
  record: IntentRecord,
  signal: AbortSignal,
): Promise<readonly EnginePush[]> {
  const stored = await parts.transactions.ofIntent(record.id, { signal });
  const steps = new Set(stored.map((tx) => tx.step));
  const plan = record.plan === undefined ? [] : planDocument.decode(record.plan);
  return plan.flatMap((draft, step) =>
    steps.has(step) ? approvalNotice(parts.chains, draft, record) : [],
  );
}

/**
 * The notices of every approval a live order or rule fill left standing (decision 0441): each fill
 * that ended `failed_onchain` with `signer_locked` since `breakerAtMs`, once a step of its plan
 * that approved a spender landed. The reset of decision 0211 signs only within a minute of the
 * fill's grant, which a pull outlasts, so the owner is told the wallet, the spender and the
 * allowance in its token.
 */
export async function breakerApprovalNotices(
  parts: BreakerApprovalParts,
  since: { readonly breakerAtMs: number; readonly signal: AbortSignal },
): Promise<readonly EnginePush[]> {
  const { signal } = since;
  const query = { states: ["failed_onchain" as const], changedSinceMs: since.breakerAtMs };
  const ended = await everyIntentOf(parts.intents, { ...query, limit: pageSize }, { signal });
  const notices = await Promise.all(
    ended.filter(isLockedFill).map(async (record) => approvalsOf(parts, record, signal)),
  );
  return notices.flat();
}
