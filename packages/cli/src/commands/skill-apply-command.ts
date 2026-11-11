import type { ProtocolId } from "@binference/protocol";
import type { AgentFlags, CommonOptions } from "../program/cli-flags.schema.js";
import type { ExitCode } from "../program/cli-output.js";
import type { CommandRun } from "../program/command-run.js";
import { withAgent } from "./agent-choice.js";
import { withEngine } from "./connect-engine.js";
import { sayProposal } from "./skill-command.js";

/** What the owner answered: yes, no, or nobody could be asked. */
type Answer = "yes" | "no" | "unasked";

// Asks the owner once more; `--yes` stands for the yes, and with no terminal nobody is asked.
async function askYes(
  run: CommandRun,
  question: {
    readonly options: CommonOptions;
    readonly key: string;
    readonly values: Readonly<Record<string, string>>;
  },
): Promise<Answer> {
  if (question.options.yes) {
    return "yes";
  }
  const { prompter } = run.host;
  if (prompter === undefined || question.options.json) {
    return "unasked";
  }
  const answer = await prompter.choose({
    id: "skillReview",
    message: run.formatter.message(`cli.${question.key}`, question.values),
    options: [
      { value: "yes", label: run.formatter.message("cli.skill.yes") },
      { value: "no", label: run.formatter.message("cli.skill.no") },
    ],
    initial: "no",
  });
  return answer === "yes" ? "yes" : "no";
}

function notAsked(
  run: CommandRun,
  key: string,
  values: Readonly<Record<string, string>>,
): ExitCode {
  run.output.fail({ code: "cli.needs_confirmation", key, values });
  return 1;
}

/**
 * `binference skill apply <proposal>` (decision 0408): shows the proposal whole, asks the owner
 * once more unless `--yes`, then applies it through `skillProposal/apply`, which needs `confirm`
 * and refuses one its scan blocks, one decided already and one whose skill moved since.
 */
export async function runSkillApply(
  run: CommandRun,
  request: { readonly options: CommonOptions; readonly proposal: ProtocolId<"skillProposal"> },
): Promise<ExitCode> {
  const { options, proposal } = request;
  return withEngine(run.host, run.output, async (client, signal) => {
    const detail = await client.call("skillProposal/get", { proposal }, { signal });
    sayProposal(run, detail);
    const answer = await askYes(run, {
      options,
      key: "skill.askApply",
      values: { name: detail.name },
    });
    if (answer === "unasked") {
      return notAsked(run, "skill.needsYes", { proposal });
    }
    if (answer === "no") {
      run.output.say("skill.notApplied");
      return 1;
    }
    const applied = await client.call("skillProposal/apply", { proposal }, { signal });
    run.output.json({ proposal, status: applied.proposal.status });
    run.output.say("skill.applied", { name: detail.name });
    return 0;
  });
}

/**
 * `binference skill accept <name> [--agent <id>]`: names the waiting workspace skill's folder and
 * hash, asks the owner once more unless `--yes`, then accepts it through `skill/accept` at that
 * hash, so its files as they are now load from the agent's next turn.
 */
export async function runSkillAccept(
  run: CommandRun,
  request: { readonly options: AgentFlags; readonly skill: string },
): Promise<ExitCode> {
  const { options, skill } = request;
  return withAgent(run, options.agent, async (client, agent, signal) => {
    const listed = await client.call("skill/list", { agent }, { signal });
    const waiting = listed.items.find((item) => item.held === true && item.name === skill);
    if (waiting === undefined) {
      run.output.fail({
        code: "skill.not_found",
        key: "skill.notWaiting",
        values: { name: skill },
      });
      return 1;
    }
    const location = waiting.location ?? skill;
    run.output.say("skill.acceptShows", { name: skill, location, hash: waiting.hash });
    const answer = await askYes(run, { options, key: "skill.askAccept", values: { name: skill } });
    if (answer !== "yes") {
      return answer === "no" ? 1 : notAsked(run, "skill.acceptNeedsYes", { name: skill });
    }
    await client.call("skill/accept", { agent, skill, hash: waiting.hash }, { signal });
    run.output.json({ agent, skill, hash: waiting.hash });
    run.output.say("skill.accepted", { name: skill });
    return 0;
  });
}
