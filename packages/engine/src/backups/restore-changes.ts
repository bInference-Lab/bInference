import type { LimitSettings } from "@binference/protocol";
import { wireNames } from "../limits/limit-views.js";
import { limitsAt, limitsChanged } from "../policy/limit-change.js";
import { sendLevelAt } from "../policy/send-level-change.js";
import {
  type AgentGuards,
  carryGuards,
  guardsAfter,
  type InstallGuards,
  type WalletFacts,
} from "./restore-guards.js";

/** A guard of one agent the backup holds stricter than now, which the restore keeps. */
export type StricterGuard = "frozen" | "archived" | "paper" | "manual" | "sendLevel";

/** One agent whose guards the restore leaves stricter than they are now. */
export interface StricterAgent {
  readonly name: string;
  readonly guards: readonly StricterGuard[];
  /** The limits that change to the backup's stricter values, by their protocol names. */
  readonly limits: readonly (keyof LimitSettings)[];
}

/**
 * What a restore changes, shown to the owner before the swap (keys spec, section 7.4): agents and
 * wallets that come or go, the guards the backup holds stricter than now, which stay, and where
 * the history of the state it replaces ends. Revokes, the Telegram owner, freezes, the rescue
 * address and the day's spending never change: the restore carries them.
 */
export interface RestoreChanges {
  readonly agentsGone: readonly string[];
  readonly agentsBack: readonly string[];
  readonly walletsGone: readonly WalletFacts[];
  readonly walletsBack: readonly WalletFacts[];
  /** Whether the backup holds the whole install frozen, and it is not now. */
  readonly isFrozen: boolean;
  readonly stricter: readonly StricterAgent[];
  /** When the newest intent of the state it replaces changed: where its history ends. */
  readonly lastActivityAtMs?: number;
}

function guardsOf(now: AgentGuards, then: AgentGuards, nowMs: number): StricterGuard[] {
  const guards: readonly (readonly [StricterGuard, boolean])[] = [
    ["frozen", now.frozenAtMs === undefined && then.frozenAtMs !== undefined],
    ["archived", now.archivedAtMs === undefined && then.archivedAtMs !== undefined],
    ["paper", now.mode !== then.mode],
    ["manual", now.approvalMode !== then.approvalMode],
    [
      "sendLevel",
      sendLevelAt(now.sendLevel, nowMs).level !== sendLevelAt(then.sendLevel, nowMs).level,
    ],
  ];
  return guards.filter(([, isStricter]) => isStricter).map(([guard]) => guard);
}

function stricterOf(
  current: InstallGuards,
  after: InstallGuards,
  nowMs: number,
): readonly StricterAgent[] {
  return after.agents.flatMap((then) => {
    const now = current.agents.find((agent) => agent.agentId === then.agentId);
    if (now === undefined) {
      return [];
    }
    const limits = limitsChanged(
      limitsAt(now.limits, nowMs).values,
      limitsAt(then.limits, nowMs).values,
    ).map((name) => wireNames[name]);
    const guards = guardsOf(now, then, nowMs);
    return guards.length === 0 && limits.length === 0 ? [] : [{ name: then.name, guards, limits }];
  });
}

function agentsMissing(
  agents: readonly AgentGuards[],
  from: readonly AgentGuards[],
): readonly string[] {
  const ids = new Set(from.map((agent) => agent.agentId));
  return agents.filter((agent) => !ids.has(agent.agentId)).map((agent) => agent.name);
}

function walletsMissing(
  wallets: readonly WalletFacts[],
  from: readonly WalletFacts[],
): readonly WalletFacts[] {
  const ids = new Set(from.map((wallet) => wallet.id));
  return wallets.filter((wallet) => !ids.has(wallet.id));
}

/**
 * What restoring `restored` over `current` at `nowMs` changes, with the carry applied, as
 * `carryGuards` would write it.
 */
export function restoreChanges(
  current: InstallGuards,
  restored: InstallGuards,
  nowMs: number,
): RestoreChanges {
  const after = guardsAfter(restored, carryGuards(current, restored, nowMs));
  const { lastActivityAtMs } = current;
  return {
    agentsGone: agentsMissing(current.agents, restored.agents),
    agentsBack: agentsMissing(restored.agents, current.agents),
    walletsGone: walletsMissing(current.wallets, restored.wallets),
    walletsBack: walletsMissing(restored.wallets, current.wallets),
    isFrozen: current.safety.frozenAtMs === undefined && after.safety.frozenAtMs !== undefined,
    stricter: stricterOf(current, after, nowMs),
    ...(lastActivityAtMs === undefined ? {} : { lastActivityAtMs }),
  };
}
