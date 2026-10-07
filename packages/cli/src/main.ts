#!/usr/bin/env node
import process from "node:process";
import { fileURLToPath } from "node:url";
import { readTextFile } from "@binference/platform";
import { z } from "zod";
import { runCli } from "./program/run-cli.js";
import { createSystemClock } from "./runtime/system-clock.js";
import { createSystemRandom } from "./runtime/system-random.js";

// The package's own manifest sits one folder up from both src/ and dist/.
const manifest = fileURLToPath(new URL("../package.json", import.meta.url));
const read = await readTextFile(manifest, AbortSignal.timeout(5_000));
const version = read.ok
  ? z.object({ version: z.string() }).parse(JSON.parse(read.value)).version
  : "unknown";

process.exitCode = await runCli({
  argv: process.argv.slice(2),
  env: process.env,
  out: (text) => process.stdout.write(text),
  err: (text) => process.stderr.write(text),
  clock: createSystemClock(),
  random: createSystemRandom(),
  signals: process,
  version,
  // Store workers run with this process's Node options, such as a TypeScript loader.
  workerExecArgv: process.execArgv,
});
