import { lookup } from "node:dns";
import process from "node:process";
import manifest from "@binference/runtime/package.json" with { type: "json" };
import { defaultContextTokens } from "../compaction/turn-history.js";
import { agentInstructions } from "../context/agent-instructions.js";
import { turnLimits } from "../loop/turn-run.js";
import type { ChainParts } from "../providers/model-transport-for.js";
import { agentToolBox } from "../tools/agent-tools.js";
import { connectEngine } from "./engine-link.js";
import { createNodeStreamingHttp } from "./node-streaming-http.js";
import { processPorts } from "./process-ports.js";
import { type RuntimeHost, runRuntime } from "./run-runtime.js";
import { openSqliteAgentDatabase } from "./sqlite-agent-database.js";
import { turnModelsOf } from "./turn-models.js";

const healthEveryMs = 10_000;
// Started from its TypeScript source, the runtime's store workers need its loader options too.
const workerExecArgv = import.meta.url.endsWith(".ts") ? process.execArgv : [];

async function writeLine(line: string): Promise<void> {
  return new Promise((resolve, reject) => {
    process.stdout.write(`${line}\n`, (error) => {
      if (error === null || error === undefined) {
        resolve();
      } else {
        reject(error);
      }
    });
  });
}

// The turns of the built runtime: binference's instructions in the owner's language, the main
// model of the settings in force and its fallbacks, or the model the owner picked for the agent
// alone (decision 0204), whose providers' rests every turn shares, the agent's tools over the
// runtime's connection to the engine and its web tools on the settings' search keys, and
// compaction on the fast model, or on the main model when no fast model is set (decision 0202).
function builtTurnSetup(parts: ChainParts): RuntimeHost["turnSetup"] {
  return ({ agent }, settings, client) => {
    const { main, summarizer, vision } = turnModelsOf(agent, settings, parts);
    return {
      models: main,
      ...(vision === undefined ? {} : { vision }),
      compaction: {
        summarizer,
        contextTokens: defaultContextTokens,
        locale: settings.owner.locale,
      },
      tools: agentToolBox({
        agent,
        client,
        web: { http: parts.http, lookup, clock: parts.clock, search: settings.search },
      }),
      instructions: agentInstructions(settings.owner.locale),
      limits: {
        ...turnLimits,
        maxToolCalls: settings.models.maxToolCallsPerTurn,
        modelIdleMs: settings.models.idleTimeoutMs,
        loopGuard: settings.models.loopDetection,
      },
    };
  };
}

/**
 * Runs the agent runtime as its own Node process, on its standard input and output (runtime spec,
 * section 2): the engine's IPC link, `agent.sqlite` on the store's workers, the process's clock,
 * and the turns' model and tools: the settings' main model over the process's own outbound HTTP
 * and the agent's tools over the engine link, unless a test gives turns of its own. Sets the exit code when it ends.
 */
export async function runNodeRuntime(
  parts: { readonly turnSetup?: RuntimeHost["turnSetup"] } = {},
): Promise<void> {
  const http = createNodeStreamingHttp({ version: manifest.version });
  const exit = await runRuntime({
    input: process.stdin,
    write: writeLine,
    connect: async (start, signal) =>
      connectEngine(start, { ...processPorts, version: manifest.version, signal }),
    openAgentDatabase: async (file, signal) =>
      openSqliteAgentDatabase(file, { signal, execArgv: workerExecArgv }),
    turnSetup:
      parts.turnSetup ?? builtTurnSetup({ http, clock: processPorts.clock, rests: new Map() }),
    clock: processPorts.clock,
    everyTenSeconds: (onTick, signal) => {
      // A write that fails means the engine has gone; the end of the input stops the runtime.
      const timer = setInterval(() => void onTick().catch(() => undefined), healthEveryMs);
      signal.addEventListener("abort", () => clearInterval(timer), { once: true });
    },
    version: manifest.version,
  });
  await http.close();
  process.exitCode = exit === "stopped" ? 0 : 1;
  // The input may still hold a read open, which would keep the process alive.
  process.stdin.destroy();
}
