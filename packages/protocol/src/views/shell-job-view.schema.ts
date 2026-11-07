import { z } from "zod";
import { type ProtocolId, protocolIdSchema } from "../ids/id-prefixes.js";

// The most output a shell job view carries, its newest part (decision 0378).
const maxShellOutputChars = 200_000;

/**
 * One command the agent runs in the owner's shell (decision 0378), as the engine answers it: still
 * `running`, or `ended` with how. `output` is what the command printed since the last read, its
 * newest part when it printed more than {@link maxShellOutputChars}, with seed phrases and private
 * key blocks masked. Every view carries outside content.
 */
export interface ShellJobView {
  readonly job: ProtocolId<"shellJob">;
  readonly status: "running" | "ended";
  readonly command: string;
  /** The folder it runs in. */
  readonly folder: string;
  readonly startedAt: number;
  readonly endedAt?: number;
  readonly exitCode?: number;
  /** The signal that ended it, such as `SIGTERM`. */
  readonly signal?: string;
  /** Its time limit ended it. */
  readonly timedOut: boolean;
  /** A stop ended it. */
  readonly stopped: boolean;
  readonly output: string;
  /** Earlier output was dropped to keep the newest part. */
  readonly outputCut: boolean;
}

/** Parses a {@link ShellJobView}. */
export const shellJobViewSchema: z.ZodType<ShellJobView> = z.object({
  job: protocolIdSchema("shellJob"),
  status: z.enum(["running", "ended"]),
  command: z.string(),
  folder: z.string(),
  startedAt: z.int().nonnegative(),
  endedAt: z.int().nonnegative().exactOptional(),
  exitCode: z.int().exactOptional(),
  signal: z.string().exactOptional(),
  timedOut: z.boolean(),
  stopped: z.boolean(),
  output: z.string().max(maxShellOutputChars),
  outputCut: z.boolean(),
});
