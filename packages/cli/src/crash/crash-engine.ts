import process from "node:process";
import { fileURLToPath } from "node:url";
import type { CliHost } from "../program/cli-host.js";
import { runCli } from "../program/run-cli.js";
import { createSystemClock } from "../runtime/system-clock.js";
import { createSystemHttp } from "../runtime/system-http.js";
import { createSystemRandom } from "../runtime/system-random.js";
import { crashEnvSchema } from "./crash-engine.schema.js";
import { crashHttp } from "./crash-http.js";
import { crashTestOrders } from "./crash-orders.js";
import { startCrashSigner } from "./crash-signer.js";

// The crash suite's engine process: `binference start --foreground` as `src/main.ts` runs it,
// started as a program of its own so the test can kill it outright. Its outside world is the
// test's: the chain and relays, Privy and KyberSwap's API on loopback, the signer's service with
// its hard rules in this process, on the agent key the engine hands it, and, for a run of live order fills, the prices that fire
// them. Like `main.ts`, it alone reads `process`.
const env = crashEnvSchema.parse(process.env);
const version = "crash";
const http = createSystemHttp({ version });
const host: CliHost = {
  argv: ["start", "--foreground", "--json", "--set", `engine.port=${env.CRASH_PORT}`],
  env: process.env,
  out: (text) => process.stdout.write(text),
  err: (text) => process.stderr.write(text),
  clock: createSystemClock(),
  random: createSystemRandom(),
  http: crashHttp(http, { relays: env.CRASH_RELAYS, services: env.CRASH_SERVICES }),
  signals: process,
  version,
  // Store workers run with this process's Node options, the TypeScript loader among them.
  workerExecArgv: process.execArgv,
  entry: {
    node: process.execPath,
    nodeOptions: process.execArgv,
    script: fileURLToPath(import.meta.url),
  },
  startSigner: startCrashSigner,
  ...(env.CRASH_FILLS === "1" ? { testOrders: crashTestOrders() } : {}),
};
process.exitCode = await runCli(host);
await http.close();
