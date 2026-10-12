import type { JsonValue } from "@binference/core";
import { z } from "zod";

/**
 * The notice kinds an agent may mute (decision 0185): fills, skipped fills, low gas, orders about
 * to expire and the daily summary of decision 0057, and the alert, exit order and update notices
 * of spec 4, sections 4.2 and 4.3. Every other kind always goes: it tells of a security event, of
 * money or a trade that needs a look, or of the engine or the agent stopping.
 */
export const mutableNoticeKinds = [
  "fill",
  "skipped",
  "lowGas",
  "orderExpiring",
  "daily",
  "alertPrice",
  "alertWallet",
  "alertLaunch",
  "ordersEnded",
  "exitEnded",
  "update",
  "updateBare",
  "updated",
  "updatedBare",
] as const;

/** A notice kind an agent may mute. */
export type MutableNoticeKind = (typeof mutableNoticeKinds)[number];

/**
 * An agent's notice settings (decision 0185), kept in its `notifications` document: the kinds it
 * muted, and the owner's time of day of its daily summary, `HH:mm`.
 */
export interface NoticeSettings {
  readonly muted: readonly MutableNoticeKind[];
  readonly dailySummaryTime: string;
}

/** The settings of decision 0057 as amended on 2026-10-12: every kind on, the summary at 09:00. */
export const defaultNoticeSettings: NoticeSettings = { muted: [], dailySummaryTime: "09:00" };

const mutableSet: ReadonlySet<string> = new Set(mutableNoticeKinds);

/** Whether a notice kind is one an agent may mute. */
export function isMutableNoticeKind(kind: string): kind is MutableNoticeKind {
  return mutableSet.has(kind);
}

/** Parses a mutable notice kind. */
export const mutableNoticeKindSchema: z.ZodType<MutableNoticeKind> = z.enum(mutableNoticeKinds);

/** Parses a time of day, `HH:mm` on the 24-hour clock. */
export const timeOfDaySchema: z.ZodType<string> = z
  .string()
  .regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/u, "a time of day as HH:mm");

/** Parses notice settings: each muted kind once, in the order given. */
export const noticeSettingsSchema: z.ZodType<NoticeSettings> = z.strictObject({
  muted: z
    .array(mutableNoticeKindSchema)
    .refine((kinds: readonly string[]) => new Set(kinds).size === kinds.length, "each kind once"),
  dailySummaryTime: timeOfDaySchema,
});

// A stored document read field by field: a field that is missing or no longer valid keeps its
// default, and a kind that cannot be muted any more is dropped, so a stored document never mutes
// more than the owner asked.
const storedSchema = z.looseObject({
  muted: z.array(z.string()).optional().catch(undefined),
  dailySummaryTime: timeOfDaySchema.optional().catch(undefined),
});

/**
 * The notice settings an agent's stored `notifications` document holds. A document from before
 * the settings, such as `{}`, reads as the defaults, and an unreadable one too: a notice then goes.
 */
export function noticeSettingsOf(stored: JsonValue): NoticeSettings {
  const parsed = storedSchema.safeParse(stored);
  if (!parsed.success) {
    return defaultNoticeSettings;
  }
  const muted = [...new Set(parsed.data.muted ?? [])].filter(isMutableNoticeKind);
  return {
    muted,
    dailySummaryTime: parsed.data.dailySummaryTime ?? defaultNoticeSettings.dailySummaryTime,
  };
}

/** The `notifications` document an agent's settings are stored as. */
export function noticeSettingsDocument(settings: NoticeSettings): JsonValue {
  return { muted: [...settings.muted], dailySummaryTime: settings.dailySummaryTime };
}

/**
 * Whether a notice of `kind` is muted for the agents it concerns (decision 0185): the agent it
 * names, or every agent of the install for a notice that names none. It is muted only when its
 * kind may be muted and every one of those agents muted it; with no agent, it goes.
 */
export function isNoticeMuted(kind: string, settings: readonly NoticeSettings[]): boolean {
  return (
    isMutableNoticeKind(kind) &&
    settings.length > 0 &&
    settings.every((each) => each.muted.includes(kind))
  );
}
