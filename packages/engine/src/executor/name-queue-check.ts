import {
  type AccountRef,
  accountRefParts,
  type ChainFamily,
  isSameAccount,
} from "@binference/chain";
import type { IntentSnapshot } from "../intents/create-stored-intents.js";
import { type CardName, type NameRecheck, recheckName } from "../names/recheck-name.js";
import { noticePush } from "../pushes/notice-push.js";
import { type ExecutionRun, moveIntent } from "./executor-run.js";
import { transferQuoteOf } from "./transfer-queue-check.js";

/** The owner's notice of a send whose name moved after its card (spec 4, section 4.4). */
const nameMovedNoticeKey = "notice.nameMoved";

/**
 * What the queue does with a confirmed intent after a send's name was read again: go on to sign
 * it (`go`, also for any intent that is no send by name), wait for the next block because the
 * chain did not answer (`unread`, decision 0308), or nothing more, since the name moved and the
 * send ended (`ended`).
 */
export type NameTake = "go" | "unread" | "ended";

// What the name points to now against the card's address: nothing, the same address of another
// kind (a contract, or a smart-account wallet switched on or off), or another address.
function nowOf(confirmed: AccountRef, now: AccountRef | undefined, family: ChainFamily): string {
  if (now === undefined) {
    return "none";
  }
  return isSameAccount(now, confirmed, family) ? "sameAddress" : "address";
}

// The owner hears what the name points to now, or that it points to none, against the card's.
function movedValues(
  name: string,
  addresses: { readonly confirmed: AccountRef; readonly now?: AccountRef },
  family: ChainFamily,
): Readonly<Record<string, string>> {
  const { confirmed, now } = addresses;
  const kind = nowOf(confirmed, now, family);
  return {
    name,
    now: kind,
    address: now === undefined ? "" : accountRefParts(now).address,
    confirmed: accountRefParts(confirmed).address,
  };
}

// A send whose name moved ends before anything signs, with its notice (spec 6, section 3).
async function endMoved(
  run: ExecutionRun,
  snapshot: IntentSnapshot,
  moved: { readonly name: string; readonly recheck: Extract<NameRecheck, { kind: "moved" }> },
): Promise<void> {
  const ended = await moveIntent(run, snapshot, { type: "name_moved" });
  if (ended === undefined) {
    return;
  }
  const { id, agentId, quote } = ended.record;
  const sent = quote === undefined ? undefined : transferQuoteOf(ended.record);
  const confirmed = sent?.kind === "send" ? sent.quote.recipient : undefined;
  run.parts.log.warn("executor.name_moved", { intentId: id });
  if (confirmed === undefined) {
    return;
  }
  const { now } = moved.recheck;
  const addresses = now === undefined ? { confirmed } : { confirmed, now };
  const values = movedValues(moved.name, addresses, run.plan.chain.family);
  run.parts.publish(noticePush({ key: nameMovedNoticeKey, agent: agentId, intent: id, values }));
}

/**
 * Reads a confirmed send's name again as its wallet's queue takes it, before any signature (spec
 * 6, section 3): a name that still points to its card's address, as the same kind of wallet, goes
 * on; one that points elsewhere or nowhere ends the send `failed_check` with `name_moved` and
 * `notice.nameMoved`; a chain that does not answer, or no resolver for its suffix, signs nothing
 * and waits for the next block (decision 0308). Any other intent goes on.
 */
export async function takeSendName(run: ExecutionRun, snapshot: IntentSnapshot): Promise<NameTake> {
  const transfer = transferQuoteOf(snapshot.record);
  const sent = transfer?.kind === "send" ? transfer.quote : undefined;
  const name = sent?.name;
  if (sent === undefined || name === undefined) {
    return "go";
  }
  const card = {
    name: name.name,
    address: sent.recipient,
    ...(name.smartAccount === undefined ? {} : { smartAccount: name.smartAccount }),
  };
  const recheck = await readAgain(run, card);
  if (recheck === undefined) {
    run.parts.log.warn("executor.name_unread", { intentId: snapshot.record.id });
    return "unread";
  }
  if (recheck.kind === "same") {
    return "go";
  }
  await endMoved(run, snapshot, { name: name.name, recheck });
  return "ended";
}

// The card's name read again through its resolver; `undefined` when no resolver serves its suffix
// or the chain does not answer. A stop ends the read as the stop asked.
async function readAgain(run: ExecutionRun, card: CardName): Promise<NameRecheck | undefined> {
  const lower = card.name.toLowerCase();
  const resolver = run.parts.nameResolvers?.find((each) => lower.endsWith(each.suffix));
  if (resolver === undefined) {
    return undefined;
  }
  const family = run.plan.chain.family;
  try {
    return await recheckName(resolver, card, { family, signal: run.signal });
  } catch {
    run.signal.throwIfAborted();
    return undefined;
  }
}
