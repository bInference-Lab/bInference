import { type ProtocolId, protocolIdSchema } from "@binference/protocol";
import { z } from "zod";

/** What every command takes: `--json` for scripts, `--yes` for questions. */
export interface CommonOptions {
  readonly json: boolean;
  readonly yes: boolean;
}

/** What `start` takes besides the common options. */
export interface StartFlags extends CommonOptions {
  /** Each `--set key=value`, in the order given. */
  readonly sets: readonly string[];
}

/** What `logs` takes besides the common options. */
export interface LogsFlags extends CommonOptions {
  readonly lines: number;
  readonly follow: boolean;
}

/** What a command on one agent takes: the agent `--agent` names, or the only one when left out. */
export interface AgentFlags extends CommonOptions {
  readonly agent?: ProtocolId<"agent">;
}

/** The most lines `logs --lines` takes. */
export const maxLogLines = 10_000;

const commonShape = {
  json: z.boolean().default(false),
  yes: z.boolean().default(false),
};

/** Parses the options commander read for `status` and `health`. */
export const commonFlagsSchema: z.ZodType<CommonOptions> = z.object(commonShape);

/** Parses the options commander read for `start`. */
export const startFlagsSchema: z.ZodType<StartFlags> = z
  .object({ ...commonShape, set: z.array(z.string()).default([]) })
  .transform(({ set, ...common }) => ({ ...common, sets: set }));

/** Parses the options commander read for a command on one agent. */
export const agentFlagsSchema: z.ZodType<AgentFlags> = z.object({
  ...commonShape,
  agent: protocolIdSchema("agent").exactOptional(),
});

/** Parses the options commander read for `logs`; 100 lines unless `--lines` says otherwise. */
export const logsFlagsSchema: z.ZodType<LogsFlags> = z.object({
  ...commonShape,
  lines: z.int().min(1).max(maxLogLines).default(100),
  follow: z.boolean().default(false),
});
