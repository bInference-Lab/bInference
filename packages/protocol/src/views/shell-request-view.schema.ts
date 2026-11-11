import { z } from "zod";
import { type ProtocolId, protocolIdSchema } from "../ids/id-prefixes.js";

/** The longest command line the agent may run. */
export const maxShellCommandChars = 8_000;

/**
 * Why a command waits for the owner's answer (decision 0409): `always` when `shell.ask` asks
 * for every command, `unlisted` when no allowed command covers it, `unreadable` when the line uses
 * shell features no allowed command can cover, `powershell` on a machine whose shell is PowerShell,
 * where none can.
 */
export type ShellAskReason = "always" | "unlisted" | "unreadable" | "powershell";

/** How the owner answers a shell request: run it once, run it and keep it allowed, or refuse it. */
export type ShellAnswer = "once" | "always" | "refuse";

/**
 * How a shell request ended: allowed once or always, refused, unanswered for 10 minutes and not
 * run or run as `shell.onNoAnswer` says, replaced by the agent's newer request, withdrawn by the
 * agent, or stopped by the owner's stop or a freeze.
 */
export type ShellRequestOutcome =
  | "allowed_once"
  | "allowed_always"
  | "refused"
  | "expired"
  | "ran_unanswered"
  | "replaced"
  | "withdrawn"
  | "stopped";

/**
 * The agent's request to run one command, which the owner answers with Allow once, Always allow or
 * Refuse until `closesAt` (decision 0409): the command, the folder it starts in, the job it runs
 * as once allowed, why it asks, and whether Always allow is offered.
 */
export interface ShellRequestView {
  readonly request: ProtocolId<"shellRequest">;
  readonly agent: ProtocolId<"agent">;
  readonly job: ProtocolId<"shellJob">;
  readonly command: string;
  readonly folder: string;
  readonly reason: ShellAskReason;
  /** Always allow is offered: the line is judged in full and no step runs other code. */
  readonly canAlwaysAllow: boolean;
  readonly createdAt: number;
  readonly closesAt: number;
}

/**
 * A command the owner allowed always (decision 0409): one step of a command line, its program by
 * its real path, its arguments word for word and the folder it starts in, and the step as it was
 * written.
 */
export interface AllowedCommandView {
  readonly allowed: ProtocolId<"allowedCommand">;
  readonly text: string;
  readonly program: string;
  readonly args: readonly string[];
  readonly folder: string;
  readonly allowedAt: number;
}

/** Parses a {@link ShellAskReason}. */
export const shellAskReasonSchema: z.ZodType<ShellAskReason> = z.enum([
  "always",
  "unlisted",
  "unreadable",
  "powershell",
]);

/** Parses a {@link ShellAnswer}. */
export const shellAnswerSchema: z.ZodType<ShellAnswer> = z.enum(["once", "always", "refuse"]);

/** Parses a {@link ShellRequestOutcome}. */
export const shellRequestOutcomeSchema: z.ZodType<ShellRequestOutcome> = z.enum([
  "allowed_once",
  "allowed_always",
  "refused",
  "expired",
  "ran_unanswered",
  "replaced",
  "withdrawn",
  "stopped",
]);

const epochMs = z.int().nonnegative();

/** Parses a {@link ShellRequestView}. */
export const shellRequestViewSchema: z.ZodType<ShellRequestView> = z.object({
  request: protocolIdSchema("shellRequest"),
  agent: protocolIdSchema("agent"),
  job: protocolIdSchema("shellJob"),
  command: z.string().min(1).max(maxShellCommandChars),
  folder: z.string().min(1),
  reason: shellAskReasonSchema,
  canAlwaysAllow: z.boolean(),
  createdAt: epochMs,
  closesAt: epochMs,
});

/** Parses an {@link AllowedCommandView}. */
export const allowedCommandViewSchema: z.ZodType<AllowedCommandView> = z.object({
  allowed: protocolIdSchema("allowedCommand"),
  text: z.string().min(1).max(maxShellCommandChars),
  program: z.string().min(1),
  args: z.array(z.string()).readonly(),
  folder: z.string().min(1),
  allowedAt: epochMs,
});
