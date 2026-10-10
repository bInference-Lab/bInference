import type { AccountRef } from "@binference/chain";
import { type Clock, err, type Id, ok, type Result, type Secret } from "@binference/core";
import type { ProtocolErrorCode } from "@binference/protocol";
import type { CeilingRefusal } from "../install/ceiling-change.js";
import type { InstallFacts } from "../install/install-record.js";
import type { CeilingEditor } from "../install/ports.js";
import type { RescueCeiling } from "../install/rescue-record.js";
import { type RescueState, rescueAt } from "../policy/rescue-change.js";
import type { AgentStore, InstallStore } from "../ports.js";
import type { PublishPush } from "../pushes/engine-push.js";
import { ceilingOutdatedNotice } from "./rescue-address-notice.js";

/** What the rescue address's ceiling changes read, write and announce through. */
export interface RescueCeilingsOptions {
  readonly install: InstallStore;
  readonly agents: AgentStore;
  readonly ceilings: CeilingEditor;
  readonly clock: Clock;
  readonly publish: PublishPush;
}

// The change that removes the old address stays valid this long after the new one takes effect,
// so an engine that was off that day still sends it.
const effectWindowMs = 7 * 86_400_000;

/** One live wallet's ceiling, and the addresses its agent saved with the owner key. */
interface WalletCeiling {
  readonly agent: Id<"agt">;
  readonly ceiling: string;
  readonly saved: readonly AccountRef[];
}

const refusalCodes: Readonly<Record<CeilingRefusal, ProtocolErrorCode>> = {
  bad_owner_key: "wallet.bad_owner_key",
  bad_recipients: "protocol.bad_args",
  not_found: "wallet.not_found",
};

async function savedOf(
  agents: AgentStore,
  agent: Id<"agt">,
  signal: AbortSignal,
): Promise<readonly [Id<"agt">, readonly AccountRef[]]> {
  const settings = await agents.get(agent, { signal });
  const saved = (settings?.addressBook ?? [])
    .filter((entry) => entry.inCeilingAtMs !== undefined)
    .map((entry) => entry.account);
  return [agent, saved];
}

async function walletCeilings(
  options: RescueCeilingsOptions,
  facts: InstallFacts,
  signal: AbortSignal,
): Promise<readonly WalletCeiling[]> {
  const live = facts.wallets.filter((wallet) => wallet.archivedAtMs === undefined);
  const agents = [...new Set(live.map((wallet) => wallet.agentId))];
  const books = new Map(
    await Promise.all(agents.map(async (agent) => savedOf(options.agents, agent, signal))),
  );
  return live.map((wallet) => ({
    agent: wallet.agentId,
    ceiling: wallet.policyId,
    saved: books.get(wallet.agentId) ?? [],
  }));
}

function recipients(
  wallet: WalletCeiling,
  addresses: readonly (AccountRef | undefined)[],
): readonly AccountRef[] {
  const listed = addresses.filter((address): address is AccountRef => address !== undefined);
  return [...new Set([...listed, ...wallet.saved])];
}

/** A rescue address move the owner key authorizes, as the rule decided it. */
export interface RescueCeilingMove {
  readonly facts: InstallFacts;
  readonly next: RescueState;
  readonly ownerKey: Secret;
  readonly signal: AbortSignal;
}

type Recipients = (wallet: WalletCeiling) => readonly AccountRef[];

async function signedChange(
  options: RescueCeilingsOptions,
  move: RescueCeilingMove,
  change: {
    readonly targets: readonly WalletCeiling[];
    readonly from: Recipients;
    readonly to: Recipients;
    readonly untilMs: number;
  },
) {
  const { targets, from, to, untilMs } = change;
  const changes = targets.map((wallet) => ({
    ceiling: wallet.ceiling,
    from: from(wallet),
    to: to(wallet),
  }));
  return options.ceilings.signRecipients(
    { ownerKey: move.ownerKey, changes, untilMs },
    { signal: move.signal },
  );
}

/**
 * Brings every live wallet's ceiling in line with a rescue address move, with the owner key
 * (decision 0110). At once, each ceiling lists the address in effect, the new one that waits and
 * its agent's saved addresses. For a new address that waits it also signs the two changes the
 * engine sends later: one that leaves the old address out once the new one takes effect, and one
 * that leaves the new address out when the owner cancels. A refusal is the protocol error code to
 * answer; nothing changed then.
 */
export async function moveRescueCeilings(
  options: RescueCeilingsOptions,
  move: RescueCeilingMove,
): Promise<Result<RescueCeiling | undefined, ProtocolErrorCode>> {
  const { next, ownerKey, signal } = move;
  const targets = await walletCeilings(options, move.facts, signal);
  const pending = next.pendingRescue;
  const now: Recipients = (wallet) => recipients(wallet, [next.rescueAddress, pending?.address]);
  const ceilings = targets.map((wallet) => ({ ceiling: wallet.ceiling, recipients: now(wallet) }));
  const set = await options.ceilings.setRecipients({ ownerKey, ceilings }, { signal });
  if (!set.ok || pending === undefined) {
    return set.ok ? ok(undefined) : err(refusalCodes[set.error]);
  }
  const onEffect = await signedChange(options, move, {
    targets,
    from: now,
    to: (wallet) => recipients(wallet, [pending.address]),
    untilMs: pending.atMs + effectWindowMs,
  });
  const onCancel =
    next.rescueAddress === undefined
      ? undefined
      : await signedChange(options, move, {
          targets,
          from: now,
          to: (wallet) => recipients(wallet, [next.rescueAddress]),
          untilMs: pending.atMs,
        });
  if (!onEffect.ok) {
    return err(refusalCodes[onEffect.error]);
  }
  if (onCancel !== undefined && !onCancel.ok) {
    return err(refusalCodes[onCancel.error]);
  }
  return ok({
    onEffect: onEffect.value,
    ...(onCancel === undefined ? {} : { onCancel: onCancel.value }),
  });
}

/** An account the owner key saves for one agent (decision 0091). */
export interface SavedAddressMove {
  readonly facts: InstallFacts;
  readonly agent: Id<"agt">;
  readonly account: AccountRef;
  readonly ownerKey: Secret;
  readonly signal: AbortSignal;
}

/**
 * Saves an account in the ceiling of each of one agent's live wallets, with the owner key: each
 * lists the rescue address in effect, a new one that waits, the agent's saved addresses and the
 * account. A refusal is the protocol error code to answer; nothing changed then. The changes
 * signed ahead for a new rescue address that waits no longer match these ceilings: sign them again
 * with {@link resignRescueCeilings}.
 */
export async function saveInCeilings(
  options: RescueCeilingsOptions,
  move: SavedAddressMove,
): Promise<Result<void, ProtocolErrorCode>> {
  const { rescueAddress, pendingRescue } = rescueAt(move.facts, options.clock.now());
  const listed = [rescueAddress, pendingRescue?.address, move.account];
  const targets = await walletCeilings(options, move.facts, move.signal);
  const ceilings = targets
    .filter((wallet) => wallet.agent === move.agent)
    .map((wallet) => ({ ceiling: wallet.ceiling, recipients: recipients(wallet, listed) }));
  const set = await options.ceilings.setRecipients(
    { ownerKey: move.ownerKey, ceilings },
    { signal: move.signal },
  );
  return set.ok ? ok(undefined) : err(refusalCodes[set.error]);
}

/**
 * Signs again, with the owner key, the changes kept for a new rescue address that waits, once a
 * ceiling joined the install or changed its recipients: each covers every live wallet's ceiling
 * as it lists now (decision 0110). With no address waiting it changes nothing. A refusal is the
 * protocol error code to answer; the changes kept before stay, and custody refuses them once due.
 */
export async function resignRescueCeilings(
  options: RescueCeilingsOptions,
  ownerKey: Secret,
  signal: AbortSignal,
): Promise<Result<void, ProtocolErrorCode>> {
  const facts = await options.install.read({ signal });
  const next = rescueAt(facts, options.clock.now());
  if (next.pendingRescue === undefined) {
    return ok(undefined);
  }
  const moved = await moveRescueCeilings(options, { facts, next, ownerKey, signal });
  if (!moved.ok) {
    return moved;
  }
  if (moved.value !== undefined) {
    await options.install.keepRescueCeiling(moved.value, { signal });
  }
  return ok(undefined);
}

/**
 * Sends the change kept for a cancelled rescue address, which leaves it out of every ceiling. When
 * custody cannot send it, the owner is told the ceilings still list the address.
 */
export async function sendCancelCeilings(
  options: RescueCeilingsOptions,
  cancelled: { readonly address: AccountRef; readonly ceiling?: RescueCeiling },
  signal: AbortSignal,
): Promise<void> {
  const change = cancelled.ceiling?.onCancel;
  if (change === undefined) {
    return;
  }
  const sent = await options.ceilings.sendSigned(change, { signal });
  if (!sent.ok) {
    options.publish(ceilingOutdatedNotice(cancelled.address));
  }
}

/**
 * Sends the change kept for a new rescue address once it has taken effect, which leaves the old
 * address out of every ceiling, and forgets the changes kept. When custody cannot send it, the
 * owner is told the ceilings still list the old address. A fault leaves it for the next settle.
 */
export async function settleRescueCeilings(
  options: RescueCeilingsOptions,
  signal: AbortSignal,
): Promise<void> {
  const facts = await options.install.read({ signal });
  const pending = facts.pendingRescue;
  const onEffect = facts.rescueCeiling?.onEffect;
  if (pending === undefined || onEffect === undefined || pending.atMs > options.clock.now()) {
    return;
  }
  const sent = await options.ceilings.sendSigned(onEffect, { signal });
  await options.install.clearRescueCeiling({ signal });
  if (!sent.ok && facts.rescueAddress !== undefined) {
    options.publish(ceilingOutdatedNotice(facts.rescueAddress));
  }
}
