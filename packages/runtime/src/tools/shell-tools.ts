import { protocolIdSchema, type ResultOf } from "@binference/protocol";
import { z } from "zod";
import type { ToolOutcome } from "../loop/turn-records.js";
import { agentToolTexts } from "./agent-tool-texts.js";
import { type AgentTool, defineTool } from "./define-tool.js";
import { answerOrRefusal } from "./tool-answer.js";
import type { AgentToolParts } from "./tool-client.js";

type ShellJobView = ResultOf<"shell/run">;

// The engine answers a call within 30 seconds, so a call waits at most 20 for its command and
// leaves the rest for the answer to travel.
const mostWaitSeconds = 20;
const answerMarginMs = 8_000;

const refusals: Readonly<Record<string, string>> = {
  "shell.off":
    "The owner turned the shell off (shell.run is off), so binference runs no command. Tell the owner; never try another way to run one.",
  "shell.no_wall":
    "This machine cannot keep commands away from binference's own files, so binference runs none here. Tell the owner.",
  "shell.folder_missing":
    "That folder does not exist. Give one that does, or leave folder out to start in the owner's home folder.",
  "shell.job_not_found":
    "This agent has no job with that id: a job is kept 30 minutes after its command ends, and none outlives a restart.",
  "shell.not_listed":
    "The owner lets only the commands they allowed always run (shell.run is listed), and this one is not among them, so it did not run. Tell the owner the command you would run and why; never try another way to run it.",
};

// Who stopped a command, as the model reads it.
const stoppers: Readonly<Record<string, string>> = {
  agent: "stopped",
  owner: "stopped by the owner's stop",
  freeze: "stopped by a freeze",
};

function endLine(view: ShellJobView): string {
  if (view.timedOut) {
    return "ended at its time limit";
  }
  if (view.stopped) {
    return stoppers[view.stoppedBy ?? "agent"] ?? "stopped";
  }
  if (view.exitCode !== undefined) {
    return `ended with exit code ${String(view.exitCode)}`;
  }
  return view.signal === undefined ? "ended" : `ended by signal ${view.signal}`;
}

function statusLine(view: ShellJobView): string {
  if (view.status === "running") {
    return `Job ${view.job} still runs in ${view.folder}. When it ends, a message from binference starts your next turn with its exit code and last lines, so do not poll it: do other work, or end your turn with a short line when only waiting is left. shell_job poll reads what it printed so far, and shell_job stop ends it.`;
  }
  return `Job ${view.job} ${endLine(view)}, in ${view.folder}.`;
}

// Why the owner is asked, as the model reads it.
const askedBecause: Readonly<Record<string, string>> = {
  always: "the owner asks before every command",
  unlisted: "the owner allowed no such command always",
  unreadable: "the line uses shell features binference cannot judge in full",
  powershell: "on PowerShell every command asks",
};

// A command that waits for the owner's answer ends the turn: the answer starts the next one.
function askingOf(view: ShellJobView): ToolOutcome {
  const why = askedBecause[view.request?.reason ?? "unlisted"] ?? "the owner asked to be asked";
  const text = `The command did not run yet: ${why}, so the owner now sees it with Allow once, Always allow and Refuse, for 10 minutes; the turn ends here. Their answer starts your next turn: what the command printed and how it ended, or that it was refused. Do not run it another way meanwhile, and do not repeat the command in your answer. Its job will be ${view.job}; shell_job stop withdraws the request.`;
  return { text, isError: false, endsTurn: true, shown: [view.command] };
}

// A command's output is outside content: any program, page or file can print words into it.
function outcomeOf(view: ShellJobView): ToolOutcome {
  if (view.status === "asking") {
    return askingOf(view);
  }
  const cut = view.outputCut ? "[earlier output was dropped]\n" : "";
  const output = view.output === "" ? "[no new output]" : `${cut}${view.output}`;
  return {
    text: `${statusLine(view)}\n${output}`,
    isError: view.status === "ended" && view.exitCode !== 0 && view.exitCode !== undefined,
    outside: view.output !== "",
  };
}

const waitSeconds = z.int().min(1).max(mostWaitSeconds).exactOptional();

const shellArgs = z.strictObject({
  command: z.string().trim().min(1).max(8_000),
  folder: z.string().min(1).max(4_096).exactOptional(),
  background: z.boolean().exactOptional(),
  waitSeconds,
  timeoutSeconds: z.int().min(0).max(86_400).exactOptional(),
});

const jobArgs = z.strictObject({
  job: protocolIdSchema("shellJob"),
  action: z.enum(["poll", "stop"]),
  waitSeconds,
});

function waitOf(seconds: number | undefined): { readonly waitMs?: number } {
  return seconds === undefined ? {} : { waitMs: seconds * 1000 };
}

const callTimeoutMs = mostWaitSeconds * 1000 + answerMarginMs;

/**
 * `shell`, a machine tool (decisions 0378 and 0409): runs one command line in the owner's login
 * shell on the engine's machine, behind the wall around binference's own files, and answers its
 * output once it ends or its wait passes, when it keeps running as a job whose end a message tells.
 * A command the owner's settings ask about first ends the turn, and the owner's answer starts the
 * next.
 */
function shellTool({ agent, client, turn }: AgentToolParts): AgentTool {
  const surface = turn.surface === undefined ? {} : { surface: turn.surface };
  return defineTool({
    name: "shell",
    kind: "machine",
    description: agentToolTexts.shell,
    args: shellArgs,
    run: async (args, { signal }) =>
      answerOrRefusal({ tool: "shell", refusals }, async () => {
        const { waitSeconds: seconds, ...rest } = args;
        const view = await client.call(
          "shell/run",
          { agent, ...rest, ...waitOf(seconds), ...surface },
          { signal, timeoutMs: callTimeoutMs },
        );
        return outcomeOf(view);
      }),
  });
}

/** `shell_job`, a machine tool (decision 0378): reads a job's new output, or stops it. */
function shellJobTool({ agent, client }: AgentToolParts): AgentTool {
  return defineTool({
    name: "shell_job",
    kind: "machine",
    description: agentToolTexts.shell_job,
    args: jobArgs,
    run: async (args, { signal }) =>
      answerOrRefusal({ tool: "shell_job", refusals }, async () => {
        const { waitSeconds: seconds, ...rest } = args;
        const view = await client.call(
          "shell/job",
          { agent, ...rest, ...waitOf(seconds) },
          { signal, timeoutMs: callTimeoutMs },
        );
        return outcomeOf(view);
      }),
  });
}

/** The agent's shell tools, `shell` and `shell_job` (runtime spec, section 5.1). */
export function shellTools(parts: AgentToolParts): readonly AgentTool[] {
  return [shellTool(parts), shellJobTool(parts)];
}
