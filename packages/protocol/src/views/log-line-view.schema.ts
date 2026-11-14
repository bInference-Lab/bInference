import type { LogLevel } from "@binference/core";
import { z } from "zod";

const levels = ["debug", "info", "warn", "error"] as const;

/** The levels of the engine log, from the least to the most severe. */
export const logLevels: readonly LogLevel[] = levels;

/** The most lines `log/recent` answers (decision 0446). */
export const maxRecentLogLines = 500;

/** Parses a {@link LogLevel}. */
export const logLevelSchema: z.ZodType<LogLevel> = z.enum(levels);

/**
 * One line of the engine log as `log/recent` answers it, kept by the support bundle's field rules
 * (decisions 0263 and 0446): its time in ISO 8601 UTC, its level, subsystem and event, and the ids
 * it carries, each by its own rule; a value that breaks its rule, and a request's host always, is
 * `[omitted]`.
 */
export interface LogLineView {
  readonly time: string;
  readonly level: LogLevel;
  readonly subsystem: string;
  readonly event: string;
  readonly fields?: Readonly<Record<string, string | number>>;
}

/**
 * The newest lines of the engine log, oldest first: `omitted` counts the lines read that lack the
 * log's JSON shape, which never show, and `cut` says older lines were left out to keep the answer
 * within its size.
 */
export interface RecentLogView {
  readonly items: readonly LogLineView[];
  readonly omitted: number;
  readonly cut?: true;
}

/** Parses a {@link LogLineView}. */
export const logLineViewSchema: z.ZodType<LogLineView> = z.object({
  time: z.string().min(1),
  level: logLevelSchema,
  subsystem: z.string().min(1),
  event: z.string().min(1),
  fields: z.record(z.string(), z.union([z.string(), z.number()])).exactOptional(),
});

/** Parses a {@link RecentLogView}. */
export const recentLogViewSchema: z.ZodType<RecentLogView> = z.object({
  items: z.array(logLineViewSchema),
  omitted: z.int().nonnegative(),
  cut: z.literal(true).exactOptional(),
});
