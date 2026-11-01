import { type AccountRef, accountRefParts } from "@binference/chain";
import type { Id } from "@binference/core";
import type { HeldCeiling } from "../ceilings/ceiling-rewrite.js";
import type { CeilingEditor } from "../install/ports.js";
import type { RescueReachRecord } from "../install/rescue-record.js";
import { rescueAt } from "../policy/rescue-change.js";
import type { EnginePush } from "../pushes/engine-push.js";
import { standingNotices } from "./rescue-bridged-notice.js";
import { type RescueChecked, type RescueCheckParts, withCheckedReach } from "./rescue-check.js";
import { isListedStanding, rescueReachOf } from "./rescue-reach.js";
import { roomedOut, walletCeilings } from "./wallet-recipients.js";

const addressOf = (account: AccountRef): string => accountRefParts(account).address.toLowerCase();

/** What keeping a check's standings reads and writes through. */
export interface RescueKeepParts extends RescueCheckParts {
  readonly ceilings: Pick<CeilingEditor, "mostPerChain">;
}

// Each account an agent's ceilings had no room for when the write listed what the check found.
async function roomedOf(
  parts: RescueKeepParts,
  checked: RescueChecked,
  signal: AbortSignal,
): Promise<readonly { readonly agent: Id<"agt">; readonly account: AccountRef }[]> {
  const facts = withCheckedReach(await parts.install.read({ signal }), checked);
  const { plan } = checked;
  const rescues = [plan.rescue.rescueAddress, plan.rescue.pendingRescue?.address];
  const reach = rescueReachOf(facts, parts.ceilings.mostPerChain);
  const wallets = await walletCeilings(parts, facts, signal);
  return wallets
    .filter((wallet) => plan.agents.includes(wallet.agent))
    .flatMap((wallet) => {
      const saving = plan.saving?.agent === wallet.agent ? { saving: plan.saving.account } : {};
      return roomedOut(wallet, { rescues, reach, ...saving }).map((account) => ({
        agent: wallet.agent,
        account,
      }));
    });
}

// What custody holds after the write: a found standing that lists an account stays only where a
// wallet of its agent read back lists it, else it is `room` when the list was full, and dropped
// when custody holds it nowhere, as after a refusal; a standing that leaves one out stays.
function heldStandings(
  found: readonly RescueReachRecord[],
  read: {
    readonly after: readonly HeldCeiling[];
    readonly roomed: readonly { readonly agent: Id<"agt">; readonly account: AccountRef }[];
  },
): readonly RescueReachRecord[] {
  return found.flatMap((record): readonly RescueReachRecord[] => {
    if (!isListedStanding(record)) {
      return [record];
    }
    const isHeld = read.after.some(
      (held) => held.wallet.agentId === record.agent && held.read.bridged.includes(record.account),
    );
    if (isHeld) {
      return [record];
    }
    const isRoomed = read.roomed.some(
      (item) => item.agent === record.agent && item.account === record.account,
    );
    return isRoomed ? [{ ...record, state: "room" }] : [];
  });
}

/**
 * Keeps what a check found once its write was read back (decision 0321): for each agent the write
 * covered, the standings custody now holds, so the engine never believes a rule pays a rescue
 * address that custody does not hold, after a refusal part way too. It answers, per agent, the
 * notices of the standings that changed, for the write to journal and announce with its ceilings.
 */
export async function keepCheckedReach(
  parts: RescueKeepParts,
  checked: RescueChecked,
  held: { readonly after: readonly HeldCeiling[]; readonly signal: AbortSignal },
): Promise<ReadonlyMap<Id<"agt">, readonly EnginePush[]>> {
  const { after, signal } = held;
  const roomed = await roomedOf(parts, checked, signal);
  const records = heldStandings(checked.found, { after, roomed });
  const { plan, before } = checked;
  const atMs = parts.clock.now();
  await parts.install.keepRescueReach({ agents: plan.agents, records, atMs }, { signal });
  const destinations = parts.rescueReads?.destinations ?? [];
  const waitsUntilMs = plan.rescue.pendingRescue?.atMs;
  const notices = new Map<Id<"agt">, readonly EnginePush[]>();
  for (const agent of plan.agents) {
    // oxlint-disable-next-line eslint/no-await-in-loop -- one agent's record at a time
    const settings = await parts.agents.get(agent, { signal });
    if (settings !== undefined) {
      const own = (list: readonly RescueReachRecord[]) =>
        list.filter((item) => item.agent === agent);
      const change = {
        before: own(before),
        after: own(records),
        destinations,
        ...(waitsUntilMs === undefined ? {} : { waitsUntilMs }),
      };
      notices.set(agent, standingNotices(settings.agent, change));
    }
  }
  return notices;
}

/**
 * Once a new rescue address took effect, turns each standing that waited for it into one that
 * pays it, and tells each agent's owner once that bridges may now pay it there (decision 0321).
 * It changes nothing while no standing waits for the address in effect.
 */
export async function joinWaitingReach(
  parts: RescueCheckParts,
  signal: AbortSignal,
): Promise<void> {
  const facts = await parts.install.read({ signal });
  const { rescueAddress } = rescueAt(facts, parts.clock.now());
  const held = facts.rescueReach ?? [];
  const home = rescueAddress === undefined ? undefined : addressOf(rescueAddress);
  const due = held.filter(
    (record) => record.state === "waiting" && addressOf(record.account) === home,
  );
  const agents = [...new Set(due.map((record) => record.agent))];
  if (agents.length === 0) {
    return;
  }
  const records = held
    .filter((record) => agents.includes(record.agent))
    .map((record): RescueReachRecord =>
      due.includes(record)
        ? { agent: record.agent, account: record.account, state: "joined" }
        : record,
    );
  const atMs = parts.clock.now();
  await parts.install.keepRescueReach({ agents, records, atMs }, { signal });
  const destinations = parts.rescueReads?.destinations ?? [];
  for (const agent of agents) {
    // oxlint-disable-next-line eslint/no-await-in-loop -- one agent's record at a time
    const settings = await parts.agents.get(agent, { signal });
    const own = (list: readonly RescueReachRecord[]) => list.filter((item) => item.agent === agent);
    const change = { before: own(held), after: own(records), destinations };
    for (const notice of settings === undefined ? [] : standingNotices(settings.agent, change)) {
      parts.publish(notice);
    }
  }
}
