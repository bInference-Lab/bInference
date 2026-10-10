import type { ProtocolClient } from "@binference/client";
import { BinferenceError, jsonValueSchema } from "@binference/core";
import { displayOutsideText } from "@binference/i18n";
import { type AgentView, operations, type ProtocolId } from "@binference/protocol";
import { z } from "zod";
import type { AgentFlags } from "../program/cli-flags.schema.js";
import type { ExitCode } from "../program/cli-output.js";
import type { CommandRun } from "../program/command-run.js";
import { type ChosenAgent, chooseAgentFirst } from "./agent-choice.js";
import { withEngine } from "./connect-engine.js";
import { acceptDisclaimer } from "./live-disclaimer.js";

/** What `binference live` or `binference paper` was asked: the mode, and the agent. */
export interface ModeRequest {
  readonly name: "live" | "paper";
  readonly options: AgentFlags;
}

// An agent's name is the owner's text from any surface: cut and made visible, as cards do.
const nameLength = 64;

const messageKeys = {
  live: { changed: "mode.live", unchanged: "mode.alreadyLive" },
  paper: { changed: "mode.paper", unchanged: "mode.alreadyPaper" },
} as const;

async function switchTo(
  client: ProtocolClient,
  request: { readonly name: "live" | "paper"; readonly agent: ProtocolId<"agent"> },
  signal: AbortSignal,
): Promise<AgentView> {
  const args = { agent: request.agent };
  return request.name === "live"
    ? client.call("agent/goLive", args, { signal })
    : client.call("agent/goPaper", args, { signal });
}

async function runSwitch(
  run: CommandRun,
  request: ModeRequest,
  chosen: ChosenAgent,
): Promise<ExitCode> {
  const { host, output } = run;
  const before = chosen.status?.mode;
  return withEngine(host, output, async (client, signal) => {
    try {
      const view = await switchTo(client, { name: request.name, agent: chosen.agent }, signal);
      output.json(jsonValueSchema.parse(z.encode(operations["agent/goLive"].result, view)));
      const keys = messageKeys[request.name];
      output.say(before === request.name ? keys.unchanged : keys.changed, {
        name: displayOutsideText(view.name, nameLength),
        agent: view.agent,
      });
      return 0;
    } catch (error) {
      if (error instanceof BinferenceError && error.code === "wallet.unfunded") {
        output.refuse("wallet.unfunded");
        output.explain("mode.fundFirst");
        return 2;
      }
      throw error;
    }
  });
}

/**
 * `binference live [--agent <id>]` and `binference paper [--agent <id>]`: switch the agent through
 * `agent/goLive` or `agent/goPaper`. Going live is terminal only: the CLI reaches the engine over
 * its IPC endpoint alone, and the server takes `agent/goLive` over IPC only. Before an agent in
 * paper mode goes live, the command shows the disclaimer and the privacy statement and the owner
 * types them back (decision 0060). Live is refused with `wallet.unfunded` until the agent's
 * default wallet holds funds, and the command then names `binference wallet address`; once live,
 * it says the first live card carries its note. The engine journals and announces each switch; a
 * switch to the mode the agent is in changes nothing. With `--json` it prints the agent after the
 * switch.
 */
export async function runModeSwitch(run: CommandRun, request: ModeRequest): Promise<ExitCode> {
  const chosen = await chooseAgentFirst(run, request.options.agent);
  if (!chosen.ok) {
    return chosen.code;
  }
  const goesLive = request.name === "live" && chosen.value.status?.mode !== "live";
  if (goesLive && !(await acceptDisclaimer(run, request.options))) {
    return 1;
  }
  return runSwitch(run, request, chosen.value);
}
