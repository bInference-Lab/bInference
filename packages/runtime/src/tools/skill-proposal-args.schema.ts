import {
  type ProtocolId,
  protocolIdSchema,
  type SkillProposalStatus,
  skillProposalLimits,
  skillProposalStatusSchema,
} from "@binference/protocol";
import { z } from "zod";

/** What `skill_proposal` does: propose, read a skill, revise a proposal, or read proposals. */
export type SkillProposalToolAction =
  | "create"
  | "update"
  | "patch"
  | "read"
  | "revise"
  | "list"
  | "inspect";

/** One support file of a proposal, by its path inside the skill's folder. */
interface SupportFileArg {
  readonly path: string;
  readonly content: string;
}

/**
 * The arguments of `skill_proposal` (decision 0408), flat for every action: each action takes the
 * ones it names, and the tool refuses a call that lacks one.
 */
export interface SkillProposalToolArgs {
  readonly action: SkillProposalToolAction;
  readonly name?: string;
  readonly description?: string;
  readonly body?: string;
  readonly supportFiles?: readonly SupportFileArg[];
  readonly revision?: string;
  readonly oldText?: string;
  readonly newText?: string;
  readonly proposal?: ProtocolId<"skillProposal">;
  readonly status?: SkillProposalStatus;
  readonly limit?: number;
  /** One line on why the agent proposes it, which the owner reads in the review. */
  readonly reason?: string;
}

/** Parses the arguments of `skill_proposal`. */
export const skillProposalToolArgs: z.ZodType<SkillProposalToolArgs> = z.strictObject({
  action: z.enum(["create", "update", "patch", "read", "revise", "list", "inspect"]),
  name: z
    .string()
    .max(64)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
    .exactOptional(),
  description: z.string().trim().min(1).max(skillProposalLimits.descriptionBytes).exactOptional(),
  body: z.string().min(1).max(skillProposalLimits.bodyBytes).exactOptional(),
  supportFiles: z
    .array(
      z.strictObject({
        path: z.string().min(1).max(200),
        content: z.string().max(skillProposalLimits.fileBytes),
      }),
    )
    .max(skillProposalLimits.files)
    .exactOptional(),
  revision: z
    .string()
    .regex(/^[0-9a-f]{64}$/)
    .exactOptional(),
  oldText: z.string().min(1).max(skillProposalLimits.bodyBytes).exactOptional(),
  newText: z.string().max(skillProposalLimits.bodyBytes).exactOptional(),
  proposal: protocolIdSchema("skillProposal").exactOptional(),
  status: skillProposalStatusSchema.exactOptional(),
  limit: z.int().min(1).max(skillProposalLimits.listMost).exactOptional(),
  reason: z
    .string()
    .trim()
    .min(1)
    .max(skillProposalLimits.purposeChars)
    .regex(/^[^\n\r]*$/u)
    .exactOptional(),
});
