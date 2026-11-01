import { err, ok, type Result } from "@binference/core";
import type { ProtocolErrorCode } from "@binference/protocol";
import type { AgentRecord } from "../agents/agent-record.js";
import type { ConfigAuthor } from "../audit/journal-config-change.js";
import {
  announceRewrite,
  type HeldCeiling,
  readCeilings,
  refreshCeilings,
} from "../ceilings/ceiling-rewrite.js";
import { venuesIn } from "../ceilings/ceiling-view-of.js";
import { callsRefusalCodes } from "../ceilings/set-ceiling.js";
import type { CeilingCalls } from "../install/ceiling-change.js";
import { rescueAt } from "../policy/rescue-change.js";
import type { ConfigJournal } from "../ports.js";
import type { RescueCeilingsOptions, SavedAddressMove } from "../safety/rescue-ceilings.js";
import { checkRescueReach, withCheckedReach } from "../safety/rescue-check.js";
import { keepCheckedReach } from "../safety/rescue-keep.js";
import { rescueReachOf } from "../safety/rescue-reach.js";
import { rescueAccounts, walletCeilings, walletRecipients } from "../safety/wallet-recipients.js";

/** What a destination save reads, writes, stores and announces through. */
export interface DestinationSaveParts extends RescueCeilingsOptions {
  readonly journal: ConfigJournal;
}

// Each wallet's calls as it holds them, with every account it may pay and the account saved.
async function callsOf(
  parts: DestinationSaveParts,
  move: SavedAddressMove,
  before: readonly HeldCeiling[],
): Promise<readonly CeilingCalls[]> {
  const payees = {
    rescues: rescueAccounts(move.facts, parts.clock.now()),
    saving: move.account,
    reach: rescueReachOf(move.facts, parts.ceilings.mostPerChain),
  };
  const wallets = await walletCeilings(parts, move.facts, move.signal);
  return before.map(({ wallet, read }) => {
    const saved = wallets.find((item) => item.ceiling === wallet.policyId)?.saved ?? [];
    const calls = {
      ceiling: wallet.policyId,
      venues: venuesIn(parts.chains, read),
      perTxNativeBase: read.perTxNativeBase,
      recipients: walletRecipients({ agent: wallet.agentId, saved }, payees),
    };
    return wallet.role === undefined ? calls : Object.assign(calls, { role: wallet.role });
  });
}

/**
 * Saves an account on a destination chain in the ceiling of each of one agent's live wallets,
 * with the owner key (decision 0313): each is planned again with its venues and its cap as it
 * holds them, and its bridge rules pay, on each destination, the rescue address in effect, a new
 * one that waits, the agent's saved addresses and the account where they are listed for that
 * destination, and a rescue address on each destination the agent's rules serve once its
 * plain-wallet check passed there, which runs first for the agent (decision 0321). Custody plans
 * every wallet before it writes any and signs nothing for a rule that holds its body already, so a
 * plan that changes no rule signs nothing. Then every wallet's stored copy is read back, even
 * after a refusal part way, the rescue addresses' standings custody holds are kept, and a change
 * that moved a ceiling or a standing is journaled and announced as `ceiling set` announces it, with
 * `notice.dayCapAdded` when it added a 24-hour cap (decision 0305). It answers each wallet's ceiling as read after the save. A
 * ceiling custody does not hold is `wallet.not_found`, and nothing is written then; any other
 * refusal is its protocol error code.
 */
export async function saveForDestination(
  parts: DestinationSaveParts,
  move: SavedAddressMove & { readonly record: AgentRecord; readonly author: ConfigAuthor },
): Promise<Result<readonly HeldCeiling[], ProtocolErrorCode>> {
  const wallets = move.facts.wallets.filter(
    (wallet) => wallet.agentId === move.agent && wallet.archivedAtMs === undefined,
  );
  const before = await readCeilings(parts, wallets, move.signal);
  if (before.length < wallets.length) {
    return err("wallet.not_found");
  }
  // The destination may gain its first bridge rule here: the rescue addresses are checked first.
  const plan = {
    agents: [move.agent],
    rescue: rescueAt(move.facts, parts.clock.now()),
    saving: { agent: move.agent, account: move.account },
  };
  const checked = await checkRescueReach(parts, plan, move.signal);
  const facts = withCheckedReach(await parts.install.read({ signal: move.signal }), checked);
  const ceilings = await callsOf(parts, { ...move, facts }, before);
  const set = await parts.ceilings.setCalls(
    { ownerKey: move.ownerKey, ceilings },
    { signal: move.signal },
  );
  if (!set.ok && set.error === "bad_owner_key") {
    return err(callsRefusalCodes[set.error]);
  }
  // A refusal part way may leave earlier ceilings changed: every copy is read back all the same.
  const after = await refreshCeilings(parts, wallets, move.signal);
  const notices = await keepCheckedReach(parts, checked, { after, signal: move.signal });
  const also = notices.get(move.agent) ?? [];
  const moved = { agent: move.record, author: move.author, signal: move.signal, also };
  await announceRewrite(parts, moved, { before, after });
  return set.ok ? ok(after) : err(callsRefusalCodes[set.error]);
}
