import { z } from "zod";
import { type ProtocolId, protocolIdSchema } from "../ids/id-prefixes.js";
import { epochMsSchema } from "../values/epoch-ms.schema.js";

/**
 * The limits of a skill proposal (decision 0408): its description and body in UTF-8 bytes, its
 * support files and their bytes, the pending proposals an agent keeps, and the page sizes of
 * `skillProposal/list`.
 */
export const skillProposalLimits = {
  descriptionBytes: 160,
  purposeChars: 280,
  bodyBytes: 40_000,
  files: 10,
  fileBytes: 40_000,
  pendingPerAgent: 20,
  listDefault: 20,
  listMost: 50,
} as const;

/** The folders of a skill a proposal may hold support files in; never `scripts/`. */
export const skillSupportFolders = ["references", "examples", "templates", "assets"] as const;

/** What a skill proposal makes: a new skill, or a new text of one of the agent's workspace skills. */
export type SkillProposalKind = "create" | "update";

/**
 * Where a skill proposal stands: waiting for the owner, applied, rejected, or `stale` once the
 * skill it changes moved, or a skill took its new name, before the owner applied it.
 */
export type SkillProposalStatus = "pending" | "applied" | "rejected" | "stale";

/**
 * One thing a proposal's scan found: the file, the line, the code (`asks_for_secret`,
 * `pipe_to_shell`, `exfiltration`, `literal_secret`, `hidden_characters` or `destructive_delete`)
 * and the sentence or line it found, with secrets redacted and hidden characters written out. Any
 * finding keeps the owner from applying the proposal.
 */
export interface SkillFindingView {
  readonly file: string;
  readonly line: number;
  readonly code: string;
  readonly text: string;
}

/** A skill proposal as a list shows it: what it is about, never its text. */
export interface SkillProposalView {
  readonly proposal: ProtocolId<"skillProposal">;
  readonly agent: ProtocolId<"agent">;
  readonly kind: SkillProposalKind;
  readonly name: string;
  readonly description: string;
  readonly status: SkillProposalStatus;
  readonly findings: readonly SkillFindingView[];
  /** The support files it writes, by path inside the skill's folder. */
  readonly files: readonly string[];
  readonly createdAt: number;
  readonly updatedAt: number;
  /** When the owner applied or rejected it, or binference found it stale. */
  readonly decidedAt?: number;
  /** The owner's words when they rejected it. */
  readonly reason?: string;
  /** The agent's one line on why it proposes it, its own words, shown to the owner. */
  readonly purpose?: string;
}

/** One line of a proposal's diff: added, removed, or the same on both sides. */
export interface SkillDiffLine {
  readonly kind: "add" | "remove" | "same";
  readonly text: string;
}

/** A support file of a proposal, with its text. */
export interface SkillSupportFile {
  readonly path: string;
  readonly text: string;
}

/**
 * A skill proposal whole: its `SKILL.md` as an apply writes it, its support files, and the diff of
 * that `SKILL.md` against the skill's text the proposal was made on (all added for a new skill).
 * `diffCut` says lines past the diff's limit were left out.
 */
export interface SkillProposalDetail extends SkillProposalView {
  readonly text: string;
  readonly supportFiles: readonly SkillSupportFile[];
  readonly diff: readonly SkillDiffLine[];
  readonly diffCut: boolean;
}

/** Parses where a skill proposal stands. */
export const skillProposalStatusSchema: z.ZodType<SkillProposalStatus, string> = z.enum([
  "pending",
  "applied",
  "rejected",
  "stale",
]);

const findingSchema: z.ZodType<SkillFindingView> = z.object({
  file: z.string(),
  line: z.int().positive(),
  code: z.string(),
  text: z.string(),
});

const viewFields = {
  proposal: protocolIdSchema("skillProposal"),
  agent: protocolIdSchema("agent"),
  kind: z.enum(["create", "update"]),
  name: z.string(),
  description: z.string(),
  status: skillProposalStatusSchema,
  findings: z.array(findingSchema),
  files: z.array(z.string()),
  createdAt: epochMsSchema,
  updatedAt: epochMsSchema,
  decidedAt: epochMsSchema.exactOptional(),
  reason: z.string().exactOptional(),
  purpose: z.string().exactOptional(),
};

/** Parses a skill proposal as a list shows it. */
export const skillProposalViewSchema: z.ZodType<SkillProposalView> = z.object(viewFields);

/** Parses a skill proposal whole. */
export const skillProposalDetailSchema: z.ZodType<SkillProposalDetail> = z.object({
  ...viewFields,
  text: z.string(),
  supportFiles: z.array(z.object({ path: z.string(), text: z.string() })),
  diff: z.array(z.object({ kind: z.enum(["add", "remove", "same"]), text: z.string() })),
  diffCut: z.boolean(),
});
