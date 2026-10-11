import { type Id, idSchema } from "@binference/core";
import { z } from "zod";
import type { AgentMode, AgentSettings } from "../agents/agent-record.js";
import { approvalModeSchema } from "../agents/approval-mode-record.js";
import { limitsValuesOf, limitsValuesSchema } from "../agents/limits-record.js";
import { sendLevelSchema, type SendLevelState } from "../agents/send-level-record.js";
import type { ApprovalMode } from "../intents/auto-mode.js";
import { type LimitsState, limitsAt, stricterLimits } from "../policy/limit-change.js";
import { sendLevelAt } from "../policy/send-level-change.js";
import { epochMsSchema } from "../records/record-fields.js";
import { type BackupRecord, backupRecordSchema } from "./backup-record.js";

/** One column's value as SQLite returns it. */
export type CarriedValue = string | number | null;

/** One row of a table a restore copies whole, column by column. */
export type CarriedRow = Readonly<Record<string, CarriedValue>>;

/**
 * Who may reach the install, as the access tables hold it: client tokens, console devices and
 * their browser push subscriptions, unused pairing and start codes, and the Mini App's launches
 * and tickets. A restore copies these whole from the state it replaces: they are never older there.
 */
export interface AccessRows {
  readonly tokens: readonly CarriedRow[];
  readonly devices: readonly CarriedRow[];
  readonly webPushSubscriptions: readonly CarriedRow[];
  readonly pairCodes: readonly CarriedRow[];
  readonly miniAppLaunches: readonly CarriedRow[];
  readonly miniAppTickets: readonly CarriedRow[];
}

/** The install's freeze and rescue address (database spec, `safety`). */
export interface SafetyGuards {
  readonly frozenAtMs?: number;
  readonly rescueAddress?: string;
  /** A new rescue address that waits for its time. */
  readonly pendingRescue?: { readonly address: string; readonly atMs: number };
  /** The rescue rules the ceilings hold, as JSON text. */
  readonly rescueCeiling?: string;
}

/** What guards one agent's funds. */
export interface AgentGuards {
  readonly agentId: Id<"agt">;
  readonly name: string;
  readonly mode: AgentMode;
  readonly frozenAtMs?: number;
  readonly archivedAtMs?: number;
  readonly approvalMode: ApprovalMode;
  readonly sendLevel: SendLevelState;
  readonly limits: LimitsState;
  /** The address book entries removed, by id, and when. */
  readonly removedAddresses: readonly { readonly id: string; readonly removedAtMs: number }[];
}

/** An outflow the rolling 24-hour cap counts: an intent confirmed in the last 24 hours. */
export interface CountedOutflow {
  readonly intentId: Id<"int">;
  readonly agentId: Id<"agt">;
  readonly isPaper: boolean;
  /** When it was confirmed. */
  readonly atMs: number;
  readonly valueUsdMicros: bigint;
}

/** A wallet as a restore shows it. */
export interface WalletFacts {
  readonly id: Id<"wal">;
  readonly agentId: Id<"agt">;
  readonly address: string;
  readonly label: string;
  readonly archivedAtMs?: number;
}

/**
 * What a restore must never loosen, read from one `engine.sqlite` (keys spec, section 7.4), and
 * what it shows the owner before the swap.
 */
export interface InstallGuards {
  readonly access: AccessRows;
  /** The owner's Telegram id once paired, and when. */
  readonly telegramOwner?: { readonly userId: number; readonly pairedAtMs: number };
  readonly safety: SafetyGuards;
  readonly agents: readonly AgentGuards[];
  readonly wallets: readonly WalletFacts[];
  /** The outflows the rolling 24-hour cap counts at the time of the read. */
  readonly outflows: readonly CountedOutflow[];
  /** The backups the install wrote, as it records them. */
  readonly backups: readonly BackupRecord[];
  /** When the newest intent changed, if any: where the history ends. */
  readonly lastActivityAtMs?: number;
}

/**
 * What a restore writes into the restored `engine.sqlite` before the swap: the access rows and
 * the Telegram owner of the state it replaces, the install's safety, each agent's guards merged,
 * every outflow the cap counts now, and the backup records the restored copy lacks.
 */
export interface GuardsCarry {
  readonly access: AccessRows;
  /** Absent removes the restored copy's owner: the state it replaces has none. */
  readonly telegramOwner?: InstallGuards["telegramOwner"];
  readonly safety: SafetyGuards;
  /** Each agent the restored copy holds, with its guards merged. */
  readonly agents: readonly AgentGuards[];
  readonly outflows: readonly CountedOutflow[];
  readonly backups: readonly BackupRecord[];
}

const carriedRowSchema: z.ZodType<CarriedRow> = z.record(
  z.string(),
  z.union([z.string(), z.number(), z.null()]),
);
const rowsSchema = z.array(carriedRowSchema).readonly();
const accessRowsSchema: z.ZodType<AccessRows> = z.strictObject({
  tokens: rowsSchema,
  devices: rowsSchema,
  webPushSubscriptions: rowsSchema,
  pairCodes: rowsSchema,
  miniAppLaunches: rowsSchema,
  miniAppTickets: rowsSchema,
});

const safetySchema: z.ZodType<SafetyGuards> = z.strictObject({
  frozenAtMs: epochMsSchema.exactOptional(),
  rescueAddress: z.string().min(1).exactOptional(),
  pendingRescue: z
    .strictObject({ address: z.string().min(1), atMs: epochMsSchema })
    .exactOptional(),
  rescueCeiling: z.string().min(1).exactOptional(),
});

const agentGuardsSchema: z.ZodType<AgentGuards> = z.strictObject({
  agentId: idSchema("agt"),
  name: z.string().min(1).max(64),
  mode: z.enum(["paper", "live"]),
  frozenAtMs: epochMsSchema.exactOptional(),
  archivedAtMs: epochMsSchema.exactOptional(),
  approvalMode: approvalModeSchema,
  sendLevel: z.strictObject({
    level: sendLevelSchema,
    pending: z.strictObject({ level: sendLevelSchema, atMs: epochMsSchema }).exactOptional(),
  }),
  limits: z.strictObject({
    values: limitsValuesSchema,
    pending: z.strictObject({ values: limitsValuesSchema, atMs: epochMsSchema }).exactOptional(),
  }),
  removedAddresses: z
    .array(z.strictObject({ id: z.string().min(1), removedAtMs: epochMsSchema }))
    .readonly(),
});

const outflowSchema: z.ZodType<CountedOutflow> = z.strictObject({
  intentId: idSchema("int"),
  agentId: idSchema("agt"),
  isPaper: z.boolean(),
  atMs: epochMsSchema,
  valueUsdMicros: z.bigint().nonnegative(),
});

const walletSchema: z.ZodType<WalletFacts> = z.strictObject({
  id: idSchema("wal"),
  agentId: idSchema("agt"),
  address: z.string().min(1),
  label: z.string(),
  archivedAtMs: epochMsSchema.exactOptional(),
});

/** Parses an {@link InstallGuards} as it crosses the store worker's boundary. */
export const installGuardsSchema: z.ZodType<InstallGuards> = z.strictObject({
  access: accessRowsSchema,
  telegramOwner: z
    .strictObject({ userId: z.int().positive(), pairedAtMs: epochMsSchema })
    .exactOptional(),
  safety: safetySchema,
  agents: z.array(agentGuardsSchema).readonly(),
  wallets: z.array(walletSchema).readonly(),
  outflows: z.array(outflowSchema).readonly(),
  backups: z.array(backupRecordSchema).readonly(),
  lastActivityAtMs: epochMsSchema.exactOptional(),
});

function stricterSendLevel(
  current: SendLevelState,
  restored: SendLevelState,
  nowMs: number,
): SendLevelState {
  const now = sendLevelAt(current, nowMs);
  const then = sendLevelAt(restored, nowMs).level;
  const level = then > now.level ? then : now.level;
  // A level the owner asked for since the backup still comes at its time, as it would have.
  return now.pending !== undefined && now.pending.level !== level
    ? { level, pending: now.pending }
    : { level };
}

function stricterLimitsState(
  current: LimitsState,
  restored: LimitsState,
  nowMs: number,
): LimitsState {
  const now = limitsAt(current, nowMs);
  const values = stricterLimits(now.values, limitsAt(restored, nowMs).values);
  return now.pending === undefined ? { values } : { values, pending: now.pending };
}

function removedOf(
  current: AgentGuards["removedAddresses"],
  restored: AgentGuards["removedAddresses"],
): AgentGuards["removedAddresses"] {
  const ids = new Set(current.map((entry) => entry.id));
  return [...current, ...restored.filter((entry) => !ids.has(entry.id))];
}

function firstOf(left?: number, right?: number): { readonly atMs?: number } {
  const atMs = left ?? right;
  return atMs === undefined ? {} : { atMs };
}

// An agent the replaced state holds too: the stricter of each guard, the newer where neither is.
function mergeAgent(current: AgentGuards, restored: AgentGuards, nowMs: number): AgentGuards {
  const frozen = firstOf(current.frozenAtMs, restored.frozenAtMs).atMs;
  const archived = firstOf(current.archivedAtMs, restored.archivedAtMs).atMs;
  return {
    agentId: restored.agentId,
    name: restored.name,
    mode: current.mode === "paper" || restored.mode === "paper" ? "paper" : "live",
    ...(frozen === undefined ? {} : { frozenAtMs: frozen }),
    ...(archived === undefined ? {} : { archivedAtMs: archived }),
    approvalMode:
      current.approvalMode === "manual" || restored.approvalMode === "manual" ? "manual" : "auto",
    sendLevel: stricterSendLevel(current.sendLevel, restored.sendLevel, nowMs),
    limits: stricterLimitsState(current.limits, restored.limits, nowMs),
    removedAddresses: removedOf(current.removedAddresses, restored.removedAddresses),
  };
}

/**
 * An agent's guards from its settings as the store reads them, with the address book entries
 * removed from it, by id, and when.
 */
export function agentGuardsOf(
  settings: AgentSettings,
  removedAddresses: AgentGuards["removedAddresses"],
): AgentGuards {
  const { agent, limits, approvalMode, sendLevel } = settings;
  const { frozenAtMs, archivedAtMs } = agent;
  const values = limitsValuesOf(limits);
  return {
    agentId: agent.id,
    name: agent.name,
    mode: agent.mode,
    ...(frozenAtMs === undefined ? {} : { frozenAtMs }),
    ...(archivedAtMs === undefined ? {} : { archivedAtMs }),
    approvalMode: approvalMode.mode,
    sendLevel:
      sendLevel.pending === undefined
        ? { level: sendLevel.level }
        : { level: sendLevel.level, pending: sendLevel.pending },
    limits: limits.pending === undefined ? { values } : { values, pending: limits.pending },
    removedAddresses,
  };
}

/**
 * What a restore carries from the state it replaces into the restored one (keys spec, section
 * 7.4), so a restore never loosens what guards the funds. A revoke stays revoked and a device or
 * token made since the backup stays as it is now: the access rows are the replaced state's. The
 * Telegram owner, the rescue address and its pending change are the newer ones. A freeze stays
 * frozen, an archived agent archived, a paper agent paper and a manual agent manual; the send
 * level and each limit are the stricter of the two in effect at `nowMs`, and a looser one the
 * owner asked for since waits for its time as it did. Every outflow the rolling 24-hour cap
 * counts now stays counted: a carried outflow takes the place of the restored copy's count of the
 * same intent. The backup records stay known.
 */
export function carryGuards(
  current: InstallGuards,
  restored: InstallGuards,
  nowMs: number,
): GuardsCarry {
  const byId = new Map(current.agents.map((agent) => [agent.agentId, agent]));
  const agents = restored.agents.map((agent) => {
    const now = byId.get(agent.agentId);
    return now === undefined ? agent : mergeAgent(now, agent, nowMs);
  });
  const known = new Set(restored.backups.map((backup) => backup.id));
  const frozen = firstOf(current.safety.frozenAtMs, restored.safety.frozenAtMs).atMs;
  const { frozenAtMs: _frozen, ...rescue } = current.safety;
  return {
    access: current.access,
    ...(current.telegramOwner === undefined ? {} : { telegramOwner: current.telegramOwner }),
    safety: { ...rescue, ...(frozen === undefined ? {} : { frozenAtMs: frozen }) },
    agents,
    outflows: current.outflows,
    backups: current.backups.filter((backup) => !known.has(backup.id)),
  };
}

/**
 * The restored state's guards once a carry is written into it, as the store writes it: a carried
 * outflow counts in the place of the restored copy's count of the same intent.
 */
export function guardsAfter(restored: InstallGuards, carry: GuardsCarry): InstallGuards {
  const { telegramOwner } = carry;
  const { telegramOwner: _replaced, ...rest } = restored;
  const carried = new Set(carry.outflows.map((outflow) => outflow.intentId));
  return {
    ...rest,
    access: carry.access,
    ...(telegramOwner === undefined ? {} : { telegramOwner }),
    safety: carry.safety,
    agents: carry.agents,
    outflows: [
      ...restored.outflows.filter((outflow) => !carried.has(outflow.intentId)),
      ...carry.outflows,
    ],
    backups: [...restored.backups, ...carry.backups],
  };
}
