import { z } from "zod";
import { epochMsSchema } from "../values/epoch-ms.schema.js";

/** The most findings a check report holds (decision 0445). */
export const maxCheckFindings = 200;

/** How one check stands: fine, a warning, a problem, or nothing this system gives it to read. */
export type CheckLevel = "ok" | "warn" | "fail" | "skip";

/**
 * A finding's words: a key of the shared i18n `check` area, such as `check.open`, and its values,
 * as the terminal prints them.
 */
export interface CheckMessageView {
  readonly key: string;
  readonly values?: Readonly<Record<string, string | number>>;
}

/**
 * One finding of `binference check` (decision 0445): its stable check id, its level, what a person
 * reads about it, and the lines that explain it, each naming the next step.
 */
export interface CheckFindingView {
  readonly check: string;
  readonly level: CheckLevel;
  readonly message?: CheckMessageView;
  readonly more?: readonly CheckMessageView[];
}

/**
 * What a `check/run` job ends with on the `job` topic: every finding, in the order the terminal
 * prints them, at most {@link maxCheckFindings}, and when the checks ran.
 */
export interface CheckReportView {
  readonly findings: readonly CheckFindingView[];
  readonly ranAt: number;
}

const messageSchema: z.ZodType<CheckMessageView> = z.object({
  key: z.string().regex(/^check\.[A-Za-z0-9_.]+$/),
  values: z.record(z.string(), z.union([z.string(), z.number()])).exactOptional(),
});

/** Parses a {@link CheckFindingView}. */
export const checkFindingViewSchema: z.ZodType<CheckFindingView> = z.object({
  check: z.string().min(1).max(128),
  level: z.enum(["ok", "warn", "fail", "skip"]),
  message: messageSchema.exactOptional(),
  more: z.array(messageSchema).exactOptional(),
});

/** Parses a {@link CheckReportView}, as a `check/run` job's `job/done` carries it. */
export const checkReportViewSchema: z.ZodType<CheckReportView> = z.object({
  findings: z.array(checkFindingViewSchema).max(maxCheckFindings),
  ranAt: epochMsSchema,
});
