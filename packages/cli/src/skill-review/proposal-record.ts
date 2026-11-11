import { type Id, idSchema } from "@binference/core";
import type {
  SkillFindingView,
  SkillProposalKind,
  SkillProposalStatus,
  SkillProposalView,
  SkillSupportFile,
} from "@binference/protocol";
import { z } from "zod";

/** The skill's text a change was proposed on: its folder hash and its `SKILL.md`. */
interface ProposalBase {
  readonly hash: string;
  readonly text: string;
}

/**
 * A skill proposal as `skill-review/proposals/<id>.json` keeps it (decision 0408): what the
 * protocol shows of it, the `SKILL.md` an apply writes, its support files, and for a change the
 * skill it was made on.
 */
export interface ProposalRecord {
  readonly proposal: Id<"skp">;
  readonly agent: Id<"agt">;
  readonly kind: SkillProposalKind;
  readonly name: string;
  readonly description: string;
  readonly status: SkillProposalStatus;
  readonly text: string;
  readonly supportFiles: readonly SkillSupportFile[];
  readonly findings: readonly SkillFindingView[];
  readonly base?: ProposalBase;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly decidedAt?: number;
  readonly reason?: string;
  readonly purpose?: string;
}

const ms = z.int().nonnegative();

/** Parses a stored proposal; a file that does not parse is left out of every read. */
export const proposalRecordSchema: z.ZodType<ProposalRecord> = z.object({
  proposal: idSchema("skp"),
  agent: idSchema("agt"),
  kind: z.enum(["create", "update"]),
  name: z.string(),
  description: z.string(),
  status: z.enum(["pending", "applied", "rejected", "stale"]),
  text: z.string(),
  supportFiles: z.array(z.object({ path: z.string(), text: z.string() })),
  findings: z.array(
    z.object({ file: z.string(), line: z.int().positive(), code: z.string(), text: z.string() }),
  ),
  base: z.object({ hash: z.string(), text: z.string() }).exactOptional(),
  createdAt: ms,
  updatedAt: ms,
  decidedAt: ms.exactOptional(),
  reason: z.string().exactOptional(),
  purpose: z.string().exactOptional(),
});

/** What a list shows of a proposal: everything but its texts. */
export function proposalViewOf(record: ProposalRecord): SkillProposalView {
  const { proposal, agent, kind, name, description, status, findings, createdAt, updatedAt } =
    record;
  const view = {
    proposal,
    agent,
    kind,
    name,
    description,
    status,
    findings,
    files: record.supportFiles.map(({ path }) => path),
    createdAt,
    updatedAt,
  };
  return {
    ...view,
    ...(record.decidedAt === undefined ? {} : { decidedAt: record.decidedAt }),
    ...(record.reason === undefined ? {} : { reason: record.reason }),
    ...(record.purpose === undefined ? {} : { purpose: record.purpose }),
  };
}
