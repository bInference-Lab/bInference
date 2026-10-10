import process from "node:process";
import { createTestSigner } from "../e2e/test-signer.js";
import type { CliHost } from "../program/cli-host.js";
import { runCli } from "../program/run-cli.js";
import { createSystemClock } from "../runtime/system-clock.js";
import { createSystemHttp } from "../runtime/system-http.js";
import { createSystemRandom } from "../runtime/system-random.js";
import { crashEnvSchema } from "./crash-engine.schema.js";
import { crashHttp } from "./crash-http.js";

// The crash suite's engine process: `binference start` as `src/main.ts` runs it, started as a
// program of its own so the test can kill it outright. Its outside world is the test's: the chain
// and relays, Privy and KyberSwap's API on loopback, and the signer in this process with the agent
// key the engine hands it. Like `main.ts`, it alone reads `process`.
const env = crashEnvSchema.parse(process.env);
const http = createSystemHttp();
const host: CliHost = {
  argv: ["start", "--json", "--set", `engine.port=${env.CRASH_PORT}`],
  env: process.env,
  out: (text) => process.stdout.write(text),
  err: (text) => process.stderr.write(text),
  clock: createSystemClock(),
  random: createSystemRandom(),
  http: crashHttp(http, { relays: env.CRASH_RELAYS, services: env.CRASH_SERVICES }),
  signals: process,
  version: "crash",
  // Store workers run with this process's Node options, the TypeScript loader among them.
  workerExecArgv: process.execArgv,
  startSigner: createTestSigner().start,
};
process.exitCode = await runCli(host);
await http.close();
