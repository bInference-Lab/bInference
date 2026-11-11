import { z } from "zod";
import { parseJsonText } from "../json-text.schema.js";
import type { ShellEnd, ShellLaunch } from "../shell-launch.js";

/** The most one line between the engine and the image's shell launcher holds, in bytes. */
export const maxLauncherLineBytes = 1_048_576;

/**
 * A line the image's shell launcher writes (decision 0412): that the command started, a piece of
 * its output, or its end, after which the launcher closes the connection.
 */
export type LauncherLine =
  | { readonly started: true }
  | { readonly output: string }
  | { readonly end: ShellEnd };

/** The line the engine writes after the command to stop it with everything it started. */
export interface LauncherStop {
  readonly stop: true;
}

const launchSchema: z.ZodType<ShellLaunch> = z.strictObject({
  command: z.string().min(1),
  folder: z.string().min(1),
  timeoutMs: z.int().min(0),
  env: z.record(z.string(), z.string()),
});

const endSchema: z.ZodType<ShellEnd> = z.strictObject({
  exitCode: z.int().exactOptional(),
  signal: z.string().max(32).exactOptional(),
  timedOut: z.boolean(),
  stopped: z.boolean(),
  failedToStart: z.string().max(64).exactOptional(),
});

const lineSchema: z.ZodType<LauncherLine> = z.union([
  z.strictObject({ started: z.literal(true) }),
  z.strictObject({ output: z.string() }),
  z.strictObject({ end: endSchema }),
]);

const stopSchema: z.ZodType<LauncherStop> = z.strictObject({ stop: z.literal(true) });

/** A connection's first line as the launcher reads it: one command, or none when out of shape. */
export function parseLaunch(text: string): ShellLaunch | undefined {
  const parsed = launchSchema.safeParse(parseJsonText(text));
  return parsed.success ? parsed.data : undefined;
}

/** A line the launcher wrote, as the engine reads it; none when out of shape. */
export function parseLauncherLine(text: string): LauncherLine | undefined {
  const parsed = lineSchema.safeParse(parseJsonText(text));
  return parsed.success ? parsed.data : undefined;
}

/** Whether a line the engine wrote after the command asks to stop it. */
export function isStopLine(text: string): boolean {
  return stopSchema.safeParse(parseJsonText(text)).success;
}

/** One line to write, as JSON with its line break. */
export function lineOf(value: LauncherLine | LauncherStop | ShellLaunch): string {
  return `${JSON.stringify(value)}\n`;
}
