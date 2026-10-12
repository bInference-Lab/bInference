import process from "node:process";
import manifest from "@binference/runtime/package.json" with { type: "json" };
import { turnLimits } from "../loop/turn-run.js";
import { createToolBox } from "../tools/create-tool-box.js";
import { connectEngine } from "./engine-link.js";
import { noModelTransport } from "./no-model-transport.js";
import { processPorts } from "./process-ports.js";
import { runRuntime } from "./run-runtime.js";
import { openSqliteAgentDatabase } from "./sqlite-agent-database.js";

// The runtime's entry and composition root. The engine starts it with `runtimeNodeArguments`, an
// empty environment and pipes for its standard input and output, which only the engine holds.
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

const exit = await runRuntime({
  input: process.stdin,
  write: writeLine,
  connect: async (start, signal) =>
    connectEngine(start, { ...processPorts, version: manifest.version, signal }),
  openAgentDatabase: async (file, signal) =>
    openSqliteAgentDatabase(file, { signal, execArgv: workerExecArgv }),
  turnSetup: (_agent, settings) => ({
    transport: noModelTransport,
    tools: createToolBox([]),
    instructions: "",
    limits: { ...turnLimits, maxToolCalls: settings.models.maxToolCallsPerTurn },
  }),
  clock: processPorts.clock,
  everyTenSeconds: (onTick, signal) => {
    // A write that fails means the engine has gone; the end of the input stops the runtime.
    const timer = setInterval(() => void onTick().catch(() => undefined), healthEveryMs);
    signal.addEventListener("abort", () => clearInterval(timer), { once: true });
  },
  version: manifest.version,
});
process.exitCode = exit === "stopped" ? 0 : 1;
// The input may still hold a read open, which would keep the process alive.
process.stdin.destroy();
