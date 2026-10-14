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
  "rpc",
  "executor",
  "backup_key",
  "runtime",
  "watcher",
]);

/** The name of a health signal in the owner's language, or the signal itself when it has none. */
export function signalName(signal: string, message: (key: string) => string): string {
  return namedSignals.has(signal) ? message(`signal.${signal}`) : signal;
}

/** How the status command names a signal and writes a time, in the owner's language. */
export interface StatusWords {
  readonly name: (signal: string) => string;
  readonly dateTime: (epochMs: number) => string;
}

function printSignal(
  output: CliOutput,
  signal: EngineStatus["health"][number],
  words: StatusWords,
): void {
  const values = { name: words.name(signal.signal), state: signal.state };
  if (signal.since === undefined) {
    output.item("status.signal", values);
  } else {
    output.item("status.signalSince", { ...values, when: words.dateTime(signal.since) });
  }
  // The price watchers say how many blocks their reads trail the chain, and how many watched
  // tokens they cannot price.
  if (signal.lagBlocks !== undefined) {
    output.item("status.signalLag", { name: values.name, blocks: signal.lagBlocks });
  }
  if (signal.unpricedTokens !== undefined && signal.unpricedTokens > 0) {
    output.item("status.signalUnpriced", { name: values.name, count: signal.unpricedTokens });
  }
}

function printStatus(output: CliOutput, status: EngineStatus, words: StatusWords) {
  output.say("status.summary", {
    version: status.version,
    state: status.state,
    protocol: String(status.protocol),
  });
  if (status.state === "locked") {
    output.say("status.locked");
  }
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
    if (agent.launchWallet !== undefined) {
      output.item("status.launchWallet", { id: agent.id, wallet: agent.launchWallet });
    }
  }
  output.say("status.signals");
  for (const signal of status.health) {
    printSignal(output, signal, words);
  }
  // The backup key warns until the owner key is entered once since the sealing key came.
  if (status.health.some((signal) => signal.signal === "backup_key" && signal.state === "warn")) {
    output.say("status.backupKeyOld");
  }
}

/**
 * `binference status`: asks the running engine for `engine/status` over IPC and prints its state,
 * release, protocol version, agents and health signals, each one that is not ok with since when
 * and the price watchers' with how many blocks they trail the chain and how many watched tokens
 * they cannot price, or the answer as JSON. Exits 1
 * when the engine cannot be reached.
 */
export async function runStatus(
  host: CliHost,
  output: CliOutput,
  words: StatusWords,
): Promise<ExitCode> {
  return withEngine(host, output, async (client, signal) => {
    const status = await client.call("engine/status", {}, { signal });
    output.json(jsonValueSchema.parse(z.encode(operations["engine/status"].result, status)));
    printStatus(output, status, words);
    return 0;
  });
}
