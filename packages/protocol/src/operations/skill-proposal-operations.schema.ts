import { z } from "zod";
import { type ProtocolId, protocolIdSchema } from "../ids/id-prefixes.js";
import { type Page, pageSchema } from "../values/page.schema.js";
import {
  type SkillProposalDetail,
  skillProposalDetailSchema,
  skillProposalLimits,
  type SkillProposalStatus,
  skillProposalStatusSchema,
  type SkillProposalView,
  skillProposalViewSchema,
  type SkillSupportFile,
} from "../views/skill-proposal-view.schema.js";
import { readFlags, writeFlags, type OperationTable } from "./operation.schema.js";

/** What a new proposal does: a new skill, a whole new body, or one exact replacement. */
export type SkillProposalAction = "create" | "update" | "patch";

/**
 * The args of `skillProposal/create` (decision 0408). `create` takes a `description` and a
 * `body`; `update` a `body`; `patch` a `find` that matches `SKILL.md` once and its `replace`.
 * `update` and `patch` name the `revision` `skill/list` gave the skill, its folder hash.
 */
interface CreateArgs {
  readonly agent: ProtocolId<"agent">;
  readonly kind: SkillProposalAction;
  readonly name: string;
  readonly description?: string;
  readonly body?: string;
  readonly files?: readonly SkillSupportFile[];
  readonly revision?: string;
  readonly find?: string;
  readonly replace?: string;
  /** The agent's one line on why it proposes it, shown to the owner. */
  readonly purpose?: string;
}

/** The args of `skillProposal/revise`: a pending proposal of the agent, changed. */
interface ReviseArgs {
  readonly agent: ProtocolId<"agent">;
  readonly proposal: ProtocolId<"skillProposal">;
  readonly description?: string;
  readonly body?: string;
  readonly files?: readonly SkillSupportFile[];
  /** A new line on why it proposes it, in place of the one the proposal holds. */
  readonly purpose?: string;
}

/** The args of `skillProposal/list`: one agent's or every one, by status, newest first. */
interface ListArgs {
  readonly agent?: ProtocolId<"agent">;
  readonly status?: SkillProposalStatus;
  readonly limit?: number;
}

/** A proposal as an apply or a reject left it. */
interface ProposalResult {
  readonly proposal: SkillProposalView;
}

/** The skill proposal operations, by name (decision 0408). */
export interface SkillProposalOperationShapes {
  readonly "skillProposal/create": { readonly args: CreateArgs; readonly result: ProposalResult };
  readonly "skillProposal/revise": { readonly args: ReviseArgs; readonly result: ProposalResult };
  readonly "skillProposal/list": {
    readonly args: ListArgs;
    readonly result: Page<SkillProposalView>;
  };
  readonly "skillProposal/get": {
    readonly args: { readonly proposal: ProtocolId<"skillProposal"> };
    readonly result: SkillProposalDetail;
  };
  readonly "skillProposal/apply": {
    readonly args: { readonly proposal: ProtocolId<"skillProposal"> };
    readonly result: ProposalResult;
  };
  readonly "skillProposal/reject": {
    readonly args: { readonly proposal: ProtocolId<"skillProposal">; readonly reason?: string };
    readonly result: ProposalResult;
  };
}

const encoder = new TextEncoder();

function bytesAtMost(most: number): (text: string) => boolean {
  return (text) => encoder.encode(text).byteLength <= most;
}

// A skill's name in the Agent Skills format: lowercase letters, digits and single hyphens.
const name = z
  .string()
  .max(64)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
const description = z
  .string()
  .trim()
  .min(1)
  .regex(/^[^\r\n]*$/)
  .refine(bytesAtMost(skillProposalLimits.descriptionBytes), {
    message: "A description is at most 160 bytes.",
  });
const body = z.string().min(1).refine(bytesAtMost(skillProposalLimits.bodyBytes), {
  message: "A body is at most 40,000 bytes.",
});
// A support file sits in one of the support folders, at most three folders deep, each part of
// letters, digits, `._-` and never starting with a dot.
const supportPath = z
  .string()
  .max(200)
  .regex(
    /^(?:references|examples|templates|assets)\/[A-Za-z0-9_-][\w.-]*(?:\/[A-Za-z0-9_-][\w.-]*){0,2}$/,
  );
const supportFiles = z
  .array(
    z.strictObject({
      path: supportPath,
      text: z.string().refine(bytesAtMost(skillProposalLimits.fileBytes), {
        message: "A support file is at most 40,000 bytes.",
      }),
    }),
  )
  .max(skillProposalLimits.files)
  .refine(
    (files: readonly SkillSupportFile[]) =>
      new Set(files.map((file) => file.path)).size === files.length,
    { message: "Each support file has its own path." },
  );
const proposal = protocolIdSchema("skillProposal");
// The agent's line on why it proposes a skill: one line the owner reads in the review.
const purpose = z
  .string()
  .trim()
  .min(1)
  .max(skillProposalLimits.purposeChars)
  .regex(/^[^\n\r]*$/u);

const proposalResult = z.object({ proposal: skillProposalViewSchema });

/** The skill proposal operations. */
export const skillProposalOperations: OperationTable<SkillProposalOperationShapes> = {
  "skillProposal/create": {
    ...readFlags,
    name: "skillProposal/create",
    scope: "agent",
    args: z.strictObject({
      agent: protocolIdSchema("agent"),
      kind: z.enum(["create", "update", "patch"]),
      name,
      description: description.exactOptional(),
      body: body.exactOptional(),
      files: supportFiles.exactOptional(),
      revision: z
        .string()
        .regex(/^[0-9a-f]{64}$/)
        .exactOptional(),
      find: z.string().min(1).max(skillProposalLimits.bodyBytes).exactOptional(),
      replace: z.string().max(skillProposalLimits.bodyBytes).exactOptional(),
      purpose: purpose.exactOptional(),
    }),
    result: proposalResult,
  },
  "skillProposal/revise": {
    ...readFlags,
    name: "skillProposal/revise",
    scope: "agent",
    args: z.strictObject({
      agent: protocolIdSchema("agent"),
      proposal,
      description: description.exactOptional(),
      body: body.exactOptional(),
      files: supportFiles.exactOptional(),
      purpose: purpose.exactOptional(),
    }),
    result: proposalResult,
  },
  "skillProposal/list": {
    ...readFlags,
    name: "skillProposal/list",
    scope: "read",
    args: z.strictObject({
      agent: protocolIdSchema("agent").exactOptional(),
      status: skillProposalStatusSchema.exactOptional(),
      limit: z.int().min(1).max(skillProposalLimits.listMost).exactOptional(),
    }),
    result: pageSchema(skillProposalViewSchema),
  },
  "skillProposal/get": {
    ...readFlags,
    name: "skillProposal/get",
    scope: "read",
    args: z.strictObject({ proposal }),
    result: skillProposalDetailSchema,
  },
  "skillProposal/apply": {
    ...writeFlags,
    name: "skillProposal/apply",
    scope: "confirm",
    args: z.strictObject({ proposal }),
    result: proposalResult,
  },
  "skillProposal/reject": {
    ...writeFlags,
    name: "skillProposal/reject",
    scope: "confirm",
    args: z.strictObject({ proposal, reason: z.string().trim().min(1).max(500).exactOptional() }),
    result: proposalResult,
  },
};
