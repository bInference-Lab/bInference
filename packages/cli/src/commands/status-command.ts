import { jsonValueSchema } from "@binference/core";
import { operations, type ResultOf } from "@binference/protocol";
import { z } from "zod";
import type { CliHost } from "../program/cli-host.js";
import type { CliOutput, ExitCode } from "../program/cli-output.js";
import { withEngine } from "./connect-engine.js";

type EngineStatus = ResultOf<"engine/status">;

// Signals with a message of their own; any other signal shows under its own name.
const namedSignals: ReadonlySet<string> = new Set([
  "event_loop",
  "memory",
  "logs",
  "custody",
  "prices",
  "wallets",
  "simulator",
  "executor",
  "network",
  "positions",
]);

/** The name of a health signal in the owner's language, or the signal itself when it has none. */
export function signalName(signal: string, message: (key: string) => string): string {
  return namedSignals.has(signal) ? message(`signal.${signal}`) : signal;
}

function printStatus(output: CliOutput, status: EngineStatus, name: (signal: string) => string) {
  output.say("status.summary", {
    version: status.version,
    state: status.state,
    protocol: String(status.protocol),
  });
  if (status.frozen) {
    output.say("status.frozen");
  }
  output.say("status.agents", { count: status.agents.length });
  for (const agent of status.agents) {
    output.item("status.agent", {
      id: agent.id,
      mode: agent.mode,
      frozen: agent.frozen ? "yes" : "no",
    });
  }
  output.say("status.signals");
  for (const signal of status.health) {
    output.item("status.signal", { name: name(signal.signal), state: signal.state });
  }
}

/**
 * `binference status`: asks the running engine for `engine/status` over IPC and prints its state,
 * release, protocol version, agents and health signals, or the answer as JSON. Exits 1 when the
 * engine cannot be reached.
 */
export async function runStatus(
  host: CliHost,
  output: CliOutput,
  name: (signal: string) => string,
): Promise<ExitCode> {
  return withEngine(host, output, async (client, signal) => {
    const status = await client.call("engine/status", {}, { signal });
    output.json(jsonValueSchema.parse(z.encode(operations["engine/status"].result, status)));
    printStatus(output, status, name);
    return 0;
  });
}
