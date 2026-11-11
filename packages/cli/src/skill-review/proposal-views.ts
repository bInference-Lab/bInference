import type { SkillProposalDetail } from "@binference/protocol";
import { lineDiff } from "./line-diff.js";
import { type ProposalRecord, proposalViewOf } from "./proposal-record.js";

/**
 * A proposal whole, as `skillProposal/get` answers it (decision 0408): its view, its `SKILL.md`,
 * its support files, and the diff of that `SKILL.md` against the skill's text the proposal was made
 * on, every line added for a new skill.
 */
export function proposalDetailOf(record: ProposalRecord): SkillProposalDetail {
  const diff = lineDiff(record.base?.text ?? "", record.text);
  return {
    ...proposalViewOf(record),
    text: record.text,
    supportFiles: record.supportFiles,
    diff: diff.lines,
    diffCut: diff.cut,
  };
}
