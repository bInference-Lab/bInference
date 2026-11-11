import { protocolIdSchema } from "@binference/protocol";
import { z } from "zod";
import type { AgentFlags, CommonOptions } from "./cli-flags.schema.js";

/** What `skill proposals` takes: the agent, and `--all` for the decided proposals too. */
export interface SkillProposalsFlags extends AgentFlags {
  readonly all: boolean;
}

/** What `skill reject` takes: the owner's reason, when they give one. */
export interface SkillRejectFlags extends CommonOptions {
  readonly reason?: string;
}

const common = { json: z.boolean().default(false), yes: z.boolean().default(false) };

/** Parses the options of `skill proposals`. */
export const skillProposalsFlagsSchema: z.ZodType<SkillProposalsFlags> = z.object({
  ...common,
  agent: protocolIdSchema("agent").exactOptional(),
  all: z.boolean().default(false),
});

/** Parses the options of `skill reject`: a reason of 1 to 500 characters. */
export const skillRejectFlagsSchema: z.ZodType<SkillRejectFlags> = z.object({
  ...common,
  reason: z.string().trim().min(1).max(500).exactOptional(),
});
