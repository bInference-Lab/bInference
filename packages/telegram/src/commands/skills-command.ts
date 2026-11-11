import { displayOutsideText } from "@binference/i18n";
import type {
  ProtocolId,
  ResultOf,
  SkillProposalDetail,
  SkillProposalView,
} from "@binference/protocol";
import type { ButtonRows } from "../ingress/bot-calls.js";
import { chooseAgent } from "./agent-commands.js";
import { commandCallbackData } from "./command-callback.schema.js";
import { callOrSay, type CommandContext, type PressContext } from "./command-context.js";
import { type SkillChoice, waitingDigest } from "./skill-callback.js";

type SkillListed = ResultOf<"skill/list">["items"][number];

/** The most changed lines a proposal's message shows, and the most characters of them. */
const diffLines = 30;
const diffChars = 2_500;
/** The most characters of one line of the agent's words, a description or a changed line. */
const lineChars = 200;

// The lines the proposal changes, each as `+ ` or `- ` and the line made visible, cut to fit.
function changedLines(detail: SkillProposalDetail): {
  readonly lines: string[];
  readonly cut: boolean;
} {
  const changed = detail.diff
    .filter(({ kind }) => kind !== "same")
    .map(
      ({ kind, text }) => `${kind === "add" ? "+" : "-"} ${displayOutsideText(text, lineChars)}`,
    );
  const lines: string[] = [];
  let room = diffChars;
  for (const line of changed.slice(0, diffLines)) {
    if (line.length > room) {
      break;
    }
    lines.push(line);
    room -= line.length + 1;
  }
  return { lines, cut: detail.diffCut || lines.length < changed.length };
}

// The agent's line on why it proposes the skill, when it gave one.
function whyLines(context: CommandContext, detail: SkillProposalDetail): readonly string[] {
  if (detail.purpose === undefined) {
    return [];
  }
  const purpose = displayOutsideText(detail.purpose, lineChars);
  return [context.words("cmd.skills.purpose", { purpose })];
}

function proposalText(context: CommandContext, detail: SkillProposalDetail): string {
  const { kind, name, findings, proposal } = detail;
  const description = displayOutsideText(detail.description, lineChars);
  const proposed = context.words("cmd.skills.proposal", { kind, name, description });
  const head = [proposed, ...whyLines(context, detail)].join("\n");
  const found =
    findings.length === 0
      ? []
      : [
          context.words("cmd.skills.blocked"),
          ...findings.map(({ file, line, code }) =>
            context.words("cmd.skills.finding", {
              file: displayOutsideText(file, 120),
              line,
              code,
            }),
          ),
        ];
  const diff = changedLines(detail);
  const cut = diff.cut ? [context.words("cmd.skills.cut", { proposal })] : [];
  return [head, ...found, "", context.words("cmd.skills.diff"), ...diff.lines, ...cut].join("\n");
}

function proposalButtons(context: CommandContext, detail: SkillProposalDetail): ButtonRows {
  const choice = (act: "apply" | "reject"): SkillChoice => ({ act, proposal: detail.proposal });
  const apply = {
    text: context.words("cmd.skills.apply"),
    data: commandCallbackData({ kind: "skill", choice: choice("apply") }),
  };
  const reject = {
    text: context.words("cmd.skills.reject"),
    data: commandCallbackData({ kind: "skill", choice: choice("reject") }),
  };
  // A proposal its scan blocks never shows an Apply, which the engine would refuse anyway.
  return [detail.findings.length === 0 ? [apply, reject] : [reject]];
}

async function sayWaiting(
  context: CommandContext,
  agent: ProtocolId<"agent">,
  skill: SkillListed,
): Promise<void> {
  const location = skill.location ?? skill.name;
  const text = context.words("cmd.skills.waiting", { name: skill.name, location });
  const digest = waitingDigest({ agent, name: skill.name, hash: skill.hash });
  const data = commandCallbackData({ kind: "skill", choice: { act: "accept", digest } });
  await context.say(text, { buttons: [[{ text: context.words("cmd.skills.accept"), data }]] });
}

// The agent's pending proposals and waiting skills, or `undefined` once a refusal was said.
async function readSkills(
  context: CommandContext,
  agent: ProtocolId<"agent">,
): Promise<
  | { readonly pending: readonly SkillProposalView[]; readonly waiting: readonly SkillListed[] }
  | undefined
> {
  const pending = await callOrSay(context, "skillProposal/list", { agent, status: "pending" });
  const listed =
    pending === undefined ? undefined : await callOrSay(context, "skill/list", { agent });
  if (pending === undefined || listed === undefined) {
    return undefined;
  }
  return { pending: pending.items, waiting: listed.items.filter(({ held }) => held === true) };
}

/**
 * `/skills` (decision 0408): each pending skill proposal of the chat's agent as a message of its
 * own, its name, kind and description, the scan findings that block it, and the lines it changes,
 * with Apply (left out while a finding blocks it) and Reject; then each waiting workspace skill
 * with Accept, bound to the folder hash the message shows. With neither, `cmd.skills.none`.
 */
export async function runSkills(context: CommandContext): Promise<void> {
  const agent = await chooseAgent(context);
  const read = agent === undefined ? undefined : await readSkills(context, agent.id);
  if (agent === undefined || read === undefined) {
    return;
  }
  if (read.pending.length === 0 && read.waiting.length === 0) {
    await context.say(context.words("cmd.skills.none"));
    return;
  }
  for (const view of read.pending) {
    // oxlint-disable-next-line eslint/no-await-in-loop -- one message after another keeps their order
    const detail = await callOrSay(context, "skillProposal/get", { proposal: view.proposal });
    if (detail !== undefined) {
      // oxlint-disable-next-line eslint/no-await-in-loop -- as above
      await context.say(proposalText(context, detail), {
        buttons: proposalButtons(context, detail),
      });
    }
  }
  for (const skill of read.waiting) {
    // oxlint-disable-next-line eslint/no-await-in-loop -- as above
    await sayWaiting(context, agent.id, skill);
  }
}

// Accepts the chat's agent's waiting skill whose digest the button carries; one whose files
// changed since the message has another digest, and nothing is accepted.
async function accepted(context: PressContext, digest: string): Promise<string | undefined> {
  const agent = await chooseAgent(context);
  const listed =
    agent === undefined ? undefined : await callOrSay(context, "skill/list", { agent: agent.id });
  if (agent === undefined || listed === undefined) {
    return undefined;
  }
  const skill = listed.items.find(
    (item) =>
      item.held === true &&
      waitingDigest({ agent: agent.id, name: item.name, hash: item.hash }) === digest,
  );
  if (skill === undefined) {
    return context.words("cmd.skills.gone");
  }
  const done = await callOrSay(context, "skill/accept", {
    agent: agent.id,
    skill: skill.name,
    hash: skill.hash,
  });
  return done === undefined ? undefined : context.words("cmd.skills.accepted");
}

async function decided(
  context: PressContext,
  choice: Exclude<SkillChoice, { readonly act: "accept" }>,
): Promise<string | undefined> {
  const done = await callOrSay(
    context,
    choice.act === "apply" ? "skillProposal/apply" : "skillProposal/reject",
    {
      proposal: choice.proposal,
    },
  );
  if (done === undefined) {
    return undefined;
  }
  return context.words(choice.act === "apply" ? "cmd.skills.applied" : "cmd.skills.rejected");
}

/**
 * A press of a `/skills` button: Apply and Reject run `skillProposal/apply` and
 * `skillProposal/reject` as the owner on Telegram, Accept runs `skill/accept` at the hash its
 * message showed. The message then says what happened in place of its buttons; a refusal is said
 * in the chat with its error's words, and the buttons stay.
 */
export async function runSkillChoice(context: PressContext, choice: SkillChoice): Promise<void> {
  const outcome =
    choice.act === "accept"
      ? await accepted(context, choice.digest)
      : await decided(context, choice);
  if (outcome !== undefined) {
    await context.edit(outcome, []);
  }
  await context.answer(outcome);
}
