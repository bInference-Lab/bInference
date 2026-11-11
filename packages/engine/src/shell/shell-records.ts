import { type Id, idSchema } from "@binference/core";
import { type ChatSurface, chatSurfaceSchema } from "@binference/protocol";
import { z } from "zod";
import { epochMsSchema } from "../records/record-fields.js";

/**
 * A command the owner allowed always (decision 0409): one step of a command line, its program by
 * its real path, its arguments word for word, the real path of the folder it starts in, and the
 * step as it was written. Install-wide.
 */
export interface AllowedCommandRecord {
  readonly id: Id<"sac">;
  readonly text: string;
  readonly program: string;
  readonly args: readonly string[];
  readonly folder: string;
  readonly allowedAtMs: number;
}

/**
 * A command the agent left running whose end the engine has still to tell it (decision 0409):
 * its job, its agent, its line and folder, when it started, and the surface of the turn that
 * started it, which the agent's next turn names. A row a restart leaves tells the agent the restart
 * lost it.
 */
export interface ShellWatchRecord {
  readonly job: Id<"shj">;
  readonly agentId: Id<"agt">;
  readonly command: string;
  readonly folder: string;
  readonly startedAtMs: number;
  readonly surface: ChatSurface;
}

/** Parses an {@link AllowedCommandRecord}. */
export const allowedCommandRecordSchema: z.ZodType<AllowedCommandRecord> = z.strictObject({
  id: idSchema("sac"),
  text: z.string().min(1).max(8_000),
  program: z.string().min(1).max(4_096),
  args: z.array(z.string().max(8_000)).max(1_000).readonly(),
  folder: z.string().min(1).max(4_096),
  allowedAtMs: epochMsSchema,
});

/** Parses a {@link ShellWatchRecord}. */
export const shellWatchRecordSchema: z.ZodType<ShellWatchRecord> = z.strictObject({
  job: idSchema("shj"),
  agentId: idSchema("agt"),
  command: z.string().min(1).max(8_000),
  folder: z.string().min(1).max(4_096),
  startedAtMs: epochMsSchema,
  surface: chatSurfaceSchema,
});
