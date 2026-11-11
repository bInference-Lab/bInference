import type { ShellAskReason } from "@binference/protocol";
import type { LineJudgment } from "./allowed-match.js";

/**
 * The owner's shell settings, read at each call (decisions 0378 and 0409): what may run, when a
 * command asks first, what a request with no answer does, a command's time limit, and whether a
 * quiet end of a command left running wakes the agent.
 */
export interface ShellSettings {
  readonly run: "off" | "listed" | "any";
  readonly ask: "never" | "unlisted" | "always";
  readonly onNoAnswer: "refuse" | "listed" | "any";
  /** A command's time limit when the call names none; 0 for no limit. */
  readonly timeoutSeconds: number;
  readonly tellOnQuietEnd: boolean;
}

/** What a command does under the settings: it runs, it asks the owner first, or it is refused. */
export type ShellVerdict =
  | { readonly kind: "run" }
  | { readonly kind: "ask"; readonly reason: ShellAskReason }
  | { readonly kind: "refuse" };

/** Whether a command needs the allowed commands to judge it under these settings. */
export function needsJudging(settings: ShellSettings): boolean {
  return settings.run === "listed" || settings.ask !== "never";
}

/**
 * What a command does (decision 0409): `shell.ask: always` asks for every one, a listed one runs,
 * `unlisted` asks for the rest, and with `never`, `shell.run: listed` refuses them and `any` runs
 * them. The shell's `off` is refused before.
 */
export function shellVerdict(settings: ShellSettings, judgment: LineJudgment): ShellVerdict {
  if (settings.ask === "always") {
    return { kind: "ask", reason: "always" };
  }
  if (judgment.listed) {
    return { kind: "run" };
  }
  if (settings.ask === "unlisted") {
    return { kind: "ask", reason: judgment.miss ?? "unlisted" };
  }
  return settings.run === "listed" ? { kind: "refuse" } : { kind: "run" };
}

/**
 * Whether a request the owner left unanswered runs (decision 0409): `shell.onNoAnswer`, never more
 * than `shell.run` allows, so `any` under `listed` runs only a listed command, judged again now.
 */
export function runsUnanswered(settings: ShellSettings, judgment: LineJudgment): boolean {
  if (settings.run === "off" || settings.onNoAnswer === "refuse") {
    return false;
  }
  return settings.onNoAnswer === "any" && settings.run === "any" ? true : judgment.listed;
}
