import process from "node:process";
import manifest from "@binference/runtime/package.json" with { type: "json" };
import { connectEngine } from "./engine-link.js";
import { processPorts } from "./process-ports.js";
import { runRuntime } from "./run-runtime.js";

// The runtime's entry and composition root. The engine starts it with `runtimeNodeArguments`, an
// empty environment and pipes for its standard input and output, which only the engine holds.
const healthEveryMs = 10_000;

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
  everyTenSeconds: (onTick, signal) => {
    // A write that fails means the engine has gone; the end of the input stops the runtime.
    const timer = setInterval(() => void onTick().catch(() => undefined), healthEveryMs);
    signal.addEventListener("abort", () => clearInterval(timer), { once: true });
  },
  version: manifest.version,
});
process.exitCode = exit === "stopped" ? 0 : 1;
