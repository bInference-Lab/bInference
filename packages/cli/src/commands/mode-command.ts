import type { ProtocolClient } from "@binference/client";
import { BinferenceError, jsonValueSchema } from "@binference/core";
import { disclaimerVersion, displayOutsideText } from "@binference/i18n";
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

/** One switch: the mode, the agent, and the disclaimer version the owner accepted now. */
interface Switch {
  readonly name: "live" | "paper";
  readonly agent: ProtocolId<"agent">;
  readonly disclaimer?: number;
}

async function switchTo(
  client: ProtocolClient,
  request: Switch,
  signal: AbortSignal,
): Promise<AgentView> {
  const { agent, disclaimer } = request;
  return request.name === "live"
    ? client.call("agent/goLive", disclaimer === undefined ? { agent } : { agent, disclaimer }, {
        signal,
      })
    : client.call("agent/goPaper", { agent }, { signal });
}

// The engine holds no acceptance of the current disclaimer: the owner reads it before a new call.
const needsDisclaimer = "needs_disclaimer";

async function runSwitch(
  run: CommandRun,
  request: Switch,
  chosen: ChosenAgent,
): Promise<ExitCode | typeof needsDisclaimer> {
  const { host, output } = run;
  const before = chosen.status?.mode;
  const asked = { disclaimer: false };
  const exit = await withEngine(host, output, async (client, signal) => {
    try {
      const view = await switchTo(client, request, signal);
      output.json(jsonValueSchema.parse(z.encode(operations["agent/goLive"].result, view)));
      const keys = messageKeys[request.name];
      output.say(before === request.name ? keys.unchanged : keys.changed, {
        name: displayOutsideText(view.name, nameLength),
        agent: view.agent,
      });
      return 0;
    } catch (error) {
      const code = error instanceof BinferenceError ? error.code : undefined;
      if (code === "agent.disclaimer" && request.disclaimer === undefined) {
        asked.disclaimer = true;
        return 1;
      }
      if (code === "wallet.unfunded") {
        output.refuse("wallet.unfunded");
        output.explain("mode.fundFirst");
        return 2;
      }
      throw error;
    }
  });
  return asked.disclaimer ? needsDisclaimer : exit;
}

/**
 * `binference live [--agent <id>]` and `binference paper [--agent <id>]`: switch the agent through
 * `agent/goLive` or `agent/goPaper`. Going live is terminal only: the CLI reaches the engine over
 * its IPC endpoint alone, and the server takes `agent/goLive` over IPC only. While the engine holds
 * no acceptance of the current disclaimer, it refuses with `agent.disclaimer`; the command then
 * shows the disclaimer and the privacy statement, the owner types the phrase back, and the
 * command calls again with the version accepted, which the engine stores (decisions 0060 and
 * 0220). Live is refused with `wallet.unfunded` until the agent's
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
  const switching = { name: request.name, agent: chosen.value.agent };
  const switched = await runSwitch(run, switching, chosen.value);
  if (switched !== needsDisclaimer) {
    return switched;
  }
  if (!(await acceptDisclaimer(run, request.options))) {
    return 1;
  }
  const accepted = await runSwitch(
    run,
    { ...switching, disclaimer: disclaimerVersion },
    chosen.value,
  );
  return accepted === needsDisclaimer ? 1 : accepted;
}
