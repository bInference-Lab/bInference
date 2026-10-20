import { type Id, idSchema, type JsonValue, jsonValueSchema } from "@binference/core";
import { z } from "zod";
import { type AgentInboxMessage, agentInboxMessageSchema } from "../chat/agent-inbox-record.js";
import { countNotice } from "../notices/notice-hour.js";
import { epochMsSchema } from "../records/record-fields.js";
import { type AlertRecord, alertRecordSchema } from "./alert-record.js";

/** The most wake-ups one agent's alerts start in any 60 minutes (protocol spec, 8.4). */
export const maxAlertWakesPerHour = 10;

/** The window the hourly limit counts wake-ups over. */
export const alertWakeWindowMs = 3_600_000;

/** How long the record of each fire is kept: the hourly limit and `wakeSkipped` read it. */
export const alertFireKeepMs = 604_800_000;

/** The most fire records one agent keeps, its newest; older ones are dropped with each fire. */
export const alertFireRowsPerAgent = 1_000;

/** Every reason a fire's wake-up starts no turn. */
const alertWakeSkips = ["frozen", "archived", "budget", "hourly", "busy"] as const;

/**
 * Why a fire stored no wake-up: the agent was frozen or archived, its model budget of the day was
 * spent, its alerts woke it 10 times in the last 60 minutes, or the agent inbox was full.
 */
export type AlertWakeSkip = (typeof alertWakeSkips)[number];

/** The skips the engine decides before the write; the store decides `hourly` and `busy`. */
type EngineWakeSkip = Extract<AlertWakeSkip, "frozen" | "archived" | "budget">;

/** The wake-up a fire stores when it starts a turn (runtime spec, section 3.3). */
export interface AlertWake {
  readonly id: Id<"msg">;
  readonly turnId: Id<"trn">;
  /** The session the message opens when its agent has none open. */
  readonly opens: Id<"ses">;
  /** The `inbox/alertFired` fields: the alert as the fire leaves it, what fired it, its mark. */
  readonly payload: JsonValue;
}

/**
 * One fire of an alert at `atMs`, which lands only while the alert is active, before its expiry,
 * and has fired `expectedFires` times: a second fire of the same count is stale. An alert with
 * `wake` carries the wake-up to store, unless the engine skipped it for `skip`.
 */
export interface AlertFireDraft {
  readonly id: Id<"alr">;
  readonly expectedFires: number;
  readonly atMs: number;
  readonly wake?: AlertWake;
  readonly skip?: EngineWakeSkip;
}

/** Parses a fire draft. */
export const alertFireDraftSchema: z.ZodType<AlertFireDraft> = z.strictObject({
  id: idSchema("alr"),
  expectedFires: z.int().nonnegative(),
  atMs: epochMsSchema,
  wake: z
    .strictObject({
      id: idSchema("msg"),
      turnId: idSchema("trn"),
      opens: idSchema("ses"),
      payload: jsonValueSchema,
    })
    .exactOptional(),
  skip: z.enum(["frozen", "archived", "budget"]).exactOptional(),
});

/**
 * What a fire wrote: the alert after it; whether it woke the agent, by a new wake-up or by the
 * waiting one it replaced; the wake-ups the hourly limit held back since the agent's last one,
 * when it woke; why it did not, for an alert with `wake`; and the message it stored or replaced.
 */
export interface AlertFireWritten {
  readonly alert: AlertRecord;
  /** Whether the fire's notice goes out: at most five an hour per alert (decision 0245). */
  readonly notify: boolean;
  /** The matches the alert's previous notice hour held back, which this fire's notice tells. */
  readonly heldBefore?: number;
  readonly woke: boolean;
  readonly wakeSkipped?: number;
  readonly skip?: AlertWakeSkip;
  readonly message?: AgentInboxMessage;
}

/** Parses what a fire wrote. */
export const alertFireWrittenSchema: z.ZodType<AlertFireWritten> = z.strictObject({
  alert: alertRecordSchema,
  notify: z.boolean(),
  heldBefore: z.int().positive().exactOptional(),
  woke: z.boolean(),
  wakeSkipped: z.int().positive().exactOptional(),
  skip: z.enum(alertWakeSkips).exactOptional(),
  message: agentInboxMessageSchema.exactOptional(),
});

/**
 * An alert as one fire at `atMs` leaves it: one fire more, fired then, and `fired` for a price
 * alert, which fires once; a wallet or launch alert stays active. Its notice hour is not moved.
 */
export function alertAfterFire(alert: AlertRecord, atMs: number): AlertRecord {
  const state = alert.condition.kind === "price" ? "fired" : alert.state;
  return { ...alert, state, fires: alert.fires + 1, firedAtMs: atMs, changedAtMs: atMs };
}

/**
 * What one fire writes of its alert, which every store adapter writes and answers: the alert
 * after it, its notice hour moved, whether its notice goes out, and the matches the previous hour
 * held back.
 */
export function alertFireOf(
  alert: AlertRecord,
  atMs: number,
): Pick<AlertFireWritten, "alert" | "notify" | "heldBefore"> {
  const notice = countNotice(alert.noticeWindow, atMs);
  const after = { ...alertAfterFire(alert, atMs), noticeWindow: notice.window };
  const told = notice.heldBefore > 0 ? { heldBefore: notice.heldBefore } : {};
  return { alert: after, notify: notice.notify, ...told };
}

/**
 * Whether a fire of the alert replaces its wake-up while that waits untaken (decision 0274): a
 * newer price or trade stands for the older one, but each launch is a token of its own, so every
 * fire of a launch alert stores its own wake-up, within the hourly limit.
 */
export function replacesWaitingWake(alert: AlertRecord): boolean {
  return alert.condition.kind !== "launch";
}

/** Whether an active alert may fire at `atMs` as the fire it expects: before its expiry. */
export function canFire(alert: AlertRecord | undefined, draft: AlertFireDraft): boolean {
  return (
    alert?.state === "active" &&
    alert.fires === draft.expectedFires &&
    (alert.expiresAtMs === undefined || draft.atMs < alert.expiresAtMs)
  );
}

/**
 * What one fire did about its wake-up, as `alert_fires` keeps it: nothing, for an alert without
 * `wake`; skipped with its reason; or woke the agent with a new message, or by replacing the one
 * still waiting.
 */
export type AlertWakeOutcome =
  | { readonly outcome: "quiet" }
  | { readonly outcome: "skipped"; readonly reason: AlertWakeSkip }
  | { readonly outcome: "woke" | "replaced"; readonly message: AgentInboxMessage };

/**
 * The part of {@link AlertFireWritten} a fire's wake-up gives, which every store adapter answers:
 * whether it woke the agent, why not, its message, and the wake-ups held back before a new one.
 */
export function wakeAnswerOf(
  wake: AlertWakeOutcome,
  wakeSkipped: number,
): Omit<AlertFireWritten, "alert" | "notify" | "heldBefore"> {
  if (wake.outcome === "quiet") {
    return { woke: false };
  }
  if (wake.outcome === "skipped") {
    return { woke: false, skip: wake.reason };
  }
  return { woke: true, message: wake.message, ...(wakeSkipped > 0 ? { wakeSkipped } : {}) };
}
