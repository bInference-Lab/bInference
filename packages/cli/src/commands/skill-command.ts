import { jsonValueSchema } from "@binference/core";
import { displayOutsideText } from "@binference/i18n";
import {
  operations,
  type ProtocolId,
  type SkillProposalDetail,
  type SkillProposalView,
} from "@binference/protocol";
import { z } from "zod";
import type { CommonOptions } from "../program/cli-flags.schema.js";
import type { ExitCode } from "../program/cli-output.js";
import type { CommandRun } from "../program/command-run.js";
import type { SkillProposalsFlags, SkillRejectFlags } from "../program/skill-flags.schema.js";
import { withAgent } from "./agent-choice.js";
import { withEngine } from "./connect-engine.js";

// A proposal's words are the agent's: each shows cut and made visible.
const lineChars = 200;

/** A proposal's list line's values. */
function proposalValues(view: SkillProposalView): Readonly<Record<string, string | number>> {
  return {
    proposal: view.proposal,
    kind: view.kind,
    name: view.name,
    status: view.status,
    findings: view.findings.length,
    description: displayOutsideText(view.description, lineChars),
  };
}

/**
 * `binference skill proposals [--agent <id>] [--all]` (decision 0408): the agent's pending skill
 * proposals, or with `--all` every one it keeps, newest first, then its workspace skills that wait
 * for the owner to accept their files. With `--json` it prints both lists as the engine answers.
 */
export async function runSkillProposals(
  run: CommandRun,
  request: { readonly options: SkillProposalsFlags },
): Promise<ExitCode> {
  const { output } = run;
  return withAgent(run, request.options.agent, async (client, agent, signal) => {
    const status = request.options.all ? {} : { status: "pending" as const };
    const page = await client.call(
      "skillProposal/list",
      { agent, ...status, limit: 50 },
      { signal },
    );
    const listed = await client.call("skill/list", { agent }, { signal });
    const waiting = listed.items.filter(({ held }) => held === true);
    const encoded = z.encode(operations["skillProposal/list"].result, page);
    output.json(jsonValueSchema.parse({ proposals: encoded, waiting }));
    output.say("skill.count", { count: page.items.length });
    for (const view of page.items) {
      output.item("skill.item", proposalValues(view));
    }
    output.say("skill.waitingCount", { count: waiting.length });
    for (const skill of waiting) {
      output.item("skill.waiting", { name: skill.name, location: skill.location ?? skill.name });
    }
    return 0;
  });
}

/** Writes a proposal whole: what it is, the findings that block it, its files and its diff. */
export function sayProposal(run: CommandRun, detail: SkillProposalDetail): void {
  const { output } = run;
  output.say("skill.head", proposalValues(detail));
  if (detail.purpose !== undefined) {
    output.say("skill.purpose", { purpose: displayOutsideText(detail.purpose, lineChars) });
  }
  if (detail.findings.length > 0) {
    output.say("skill.blocked");
  }
  for (const { file, line, code, text } of detail.findings) {
    output.item("skill.finding", { file, line, code, text: displayOutsideText(text, lineChars) });
  }
  if (detail.files.length > 0) {
    output.say("skill.files", { files: detail.files.join(", ") });
  }
  for (const { kind, text } of detail.diff) {
    const mark = { add: "+", remove: "-", same: " " }[kind];
    output.item("skill.diffLine", { line: `${mark} ${displayOutsideText(text, lineChars)}` });
  }
  if (detail.diffCut) {
    output.say("skill.diffCut");
  }
}

/**
 * `binference skill show <proposal>`: the proposal whole, through `skillProposal/get`, its scan
 * findings and the diff of its `SKILL.md` against the skill it changes. With `--json` it prints
 * the proposal as the engine answers it.
 */
export async function runSkillShow(
  run: CommandRun,
  request: { readonly options: CommonOptions; readonly proposal: ProtocolId<"skillProposal"> },
): Promise<ExitCode> {
  return withEngine(run.host, run.output, async (client, signal) => {
    const detail = await client.call(
      "skillProposal/get",
      { proposal: request.proposal },
      { signal },
    );
    run.output.json(
      jsonValueSchema.parse(z.encode(operations["skillProposal/get"].result, detail)),
    );
    sayProposal(run, detail);
    return 0;
  });
}

/**
 * `binference skill reject <proposal> [--reason <text>]`: turns the proposal down through
 * `skillProposal/reject`, which needs `confirm`; the agent reads the reason at its next turn.
 */
export async function runSkillReject(
  run: CommandRun,
  request: { readonly options: SkillRejectFlags; readonly proposal: ProtocolId<"skillProposal"> },
): Promise<ExitCode> {
  const { reason } = request.options;
  return withEngine(run.host, run.output, async (client, signal) => {
    const args = { proposal: request.proposal, ...(reason === undefined ? {} : { reason }) };
    const { proposal } = await client.call("skillProposal/reject", args, { signal });
    run.output.json({ proposal: proposal.proposal, status: proposal.status });
    run.output.say("skill.rejected");
    return 0;
  });
}
