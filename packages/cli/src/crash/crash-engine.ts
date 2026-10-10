import process from "node:process";
import { BinferenceError } from "@binference/core";
import type { CliHost } from "../program/cli-host.js";
import { createSystemClock } from "../runtime/system-clock.js";
import { createSystemHttp } from "../runtime/system-http.js";
import { createSystemRandom } from "../runtime/system-random.js";
import { crashEnvSchema, type CrashEvent } from "./crash-engine.schema.js";
import { crashHttp } from "./crash-http.js";
import { runCrashEngine } from "./run-crash-engine.js";

// The crash suite's engine process: what `binference start` composes of the money path, started
// as a program of its own so the test can kill it outright. Like `main.ts`, it alone reads
// `process`; it reports to the test in JSON lines on standard output.
const env = crashEnvSchema.parse(process.env);
const report = (event: CrashEvent): void => {
  process.stdout.write(`${JSON.stringify(event)}\n`);
};
const http = createSystemHttp();
const host: CliHost = {
  argv: [],
  env: process.env,
  out: (text) => process.stdout.write(text),
  err: (text) => process.stderr.write(text),
  clock: createSystemClock(),
  random: createSystemRandom(),
  http: crashHttp(http, env.CRASH_RELAYS),
  signals: process,
  version: "crash",
  // Store workers run with this process's Node options, the TypeScript loader among them.
  workerExecArgv: process.execArgv,
};
try {
  await runCrashEngine(host, env, report);
} catch (error) {
  const code = error instanceof BinferenceError ? error.code : "unexpected";
  const message = error instanceof Error ? error.message : String(error);
  report({ event: "failed", code, message });
  process.exitCode = 1;
}
await http.close();
