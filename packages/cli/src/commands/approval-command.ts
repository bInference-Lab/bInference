import type { ProtocolId, ResultOf } from "@binference/protocol";
import type { AgentFlags } from "../program/cli-flags.schema.js";
import type { ExitCode } from "../program/cli-output.js";
import type { ApprovalModeChoice } from "../program/cli-program.js";
import type { CommandRun } from "../program/command-run.js";
import { chooseAgent } from "./agent-choice.js";
import { withEngine } from "./connect-engine.js";

/** What `binference approval` was asked: the agent, and the mode to set, if any. */
export interface ApprovalRequest {
  readonly options: AgentFlags;
  readonly mode?: ApprovalModeChoice;
}

type ApprovalState = ResultOf<"approval/get">;

function printMode(
  run: CommandRun,
  agent: ProtocolId<"agent">,
  state: { readonly approval: ApprovalState; readonly key: string },
): void {
  const { approval, key } = state;
  run.output.json({ agent, mode: approval.mode, changedAt: approval.changedAt });
  run.output.say(key, {
    agent,
    mode: approval.mode,
    changedAt: run.formatter.dateTime(approval.changedAt),
  });
}

/**
 * `binference approval [manual|auto] [--agent <id>]`: shows the agent's approval mode, or sets it
 * through `approval/set`. Switching to `auto` is a loosening the CLI may make, since it holds the
 * `loosen` scope; the engine journals each switch and announces it on every surface. Setting the
 * mode the agent is in changes nothing. With `--json` it prints `{ agent, mode, changedAt }`.
 */
export async function runApproval(run: CommandRun, request: ApprovalRequest): Promise<ExitCode> {
  const { host, output } = run;
  return withEngine(host, output, async (client, signal) => {
    const chosen = await chooseAgent({ client, output, signal }, request.options.agent);
    if (chosen === undefined) {
      return 1;
    }
    const { agent } = chosen;
    const current = await client.call("approval/get", { agent }, { signal });
    if (request.mode === undefined || request.mode === current.mode) {
      const key = request.mode === undefined ? "approval.current" : "approval.unchanged";
      printMode(run, agent, { approval: current, key });
      return 0;
    }
    const set = await client.call("approval/set", { agent, mode: request.mode }, { signal });
    printMode(run, agent, { approval: set, key: "approval.set" });
    if (set.mode === "auto") {
      output.say("approval.autoNote");
    }
    return 0;
  });
}
