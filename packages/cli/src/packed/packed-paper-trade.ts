import { join } from "node:path";
import process from "node:process";
import { BinferenceError } from "@binference/core";
import { readTextFile } from "@binference/platform";
import { z } from "zod";
import type { SourceProgram } from "../e2e/source-program.js";
import { openSmokeParts, type SmokeParts, type SmokeScript } from "./packed-smoke-parts.js";
import { lastJsonLine, pairOwner, paperTradeScript, tradeByChat } from "./smoke-chat.js";
import { startPaperPortfolio } from "./smoke-paper-start.js";

// The built-package smoke's paper trade by chat, which `pnpm release:smoke` runs with the folder
// the packed tarballs were installed in. The binference under test is that install's alone: each
// command runs its own file with this Node and no loader or condition of the workspace. It sets
// up with `init --yes` in a fresh state folder, starts the engine in the foreground, pairs the
// owner on the synthetic Bot API, asks the agent for USDT for 0.001 BNB, taps Confirm on the card,
// waits for the paper fill and the agent's report, and stops the engine. Privy and Telegram are
// the e2e fakes behind a proxy on the loopback, which the install names in `network.proxy`; the
// model is a scripted one on the loopback; quotes come from BNB Smart Chain's public RPCs and
// KyberSwap's API through the same proxy. Like `src/main.ts`, it reads `process`. It prints one
// JSON line with each step's time in milliseconds, or the failure and the engine log's end.

const minute = 60_000;
const script: SmokeScript = paperTradeScript;
const stateSchema = z.looseObject({ state: z.string() });
const initSchema = z.looseObject({ state: z.string(), pairing: z.object({ link: z.url() }) });

function fault(code: string, message: string): BinferenceError {
  return new BinferenceError({ code: `smoke.${code}`, message });
}

// `init --yes`, and the start code of the pairing link it printed.
async function setUp(parts: SmokeParts): Promise<string> {
  const init = await parts.binference.run(parts.initArgs, 3 * minute);
  const parsed = initSchema.safeParse(JSON.parse(lastJsonLine(init.stdout)));
  if (init.exitCode !== 0 || !parsed.success) {
    throw fault("init_failed", `init ended with ${String(init.exitCode)}:\n${init.stdout}`);
  }
  return new URL(parsed.data.pairing.link).searchParams.get("start") ?? "";
}

// `start --foreground`, ready once it prints its JSON line and the bot polls Telegram.
async function startEngine(parts: SmokeParts, signal: AbortSignal): Promise<SourceProgram> {
  const engine = parts.binference.start(["start", "--foreground", "--json"], signal);
  const timer: { id?: NodeJS.Timeout } = {};
  const quiet = new Promise<never>((_resolve, reject) => {
    timer.id = setTimeout(() => {
      reject(fault("not_ready", "binference start printed no state within 2 minutes."));
    }, 2 * minute);
  });
  const line = await Promise.race([engine.lineWith('{"state"'), quiet]).finally(() => {
    clearTimeout(timer.id);
  });
  const started = stateSchema.safeParse(JSON.parse(line.startsWith("{") ? line : "null"));
  if (!started.success || started.data.state !== "ready") {
    throw fault("not_ready", `binference start did not turn ready:\n${line}`);
  }
  const polls = (api: typeof parts.bot.api) =>
    api.calls().some((call) => call.method === "getUpdates");
  await parts.bot.until("poll for updates", polls, minute);
  return engine;
}

// `binference stop`, then the foreground engine's own end: exit code 0 and its stopped line.
async function stopEngine(parts: SmokeParts, engine: SourceProgram): Promise<void> {
  const stop = await parts.binference.run(["stop", "--json"], minute);
  const stopped = stateSchema.safeParse(JSON.parse(lastJsonLine(stop.stdout)));
  if (stop.exitCode !== 0 || stopped.data?.state !== "stopped") {
    throw fault(
      "stop_failed",
      `binference stop ended with ${String(stop.exitCode)}:\n${stop.stdout}`,
    );
  }
  const exitCode = await engine.program.exited;
  if (exitCode !== 0) {
    throw fault("stop_failed", `The engine ended with ${String(exitCode)}.`);
  }
}

async function logTail(home: string): Promise<string> {
  const read = await readTextFile(join(home, "logs", "engine.log"), AbortSignal.timeout(5_000));
  return read.ok ? read.value.split("\n").slice(-40).join("\n") : "No engine log.";
}

// Runs the smoke's steps in order, and answers each one's time in milliseconds.
async function smoke(parts: SmokeParts, engineStop: AbortSignal): Promise<Record<string, number>> {
  const times = new Map<string, number>();
  const timed = async <T>(name: string, run: () => Promise<T>): Promise<T> => {
    const started = performance.now();
    const value = await run();
    times.set(name, Math.round(performance.now() - started));
    return value;
  };
  const code = await timed("init", async () => setUp(parts));
  const engine = await timed("start", async () => startEngine(parts, engineStop));
  await timed("pair", async () => pairOwner(parts.bot, code));
  await timed("paperStart", async () =>
    startPaperPortfolio(parts.home, AbortSignal.timeout(minute)),
  );
  await timed("trade", async () => tradeByChat(parts.bot, script.report));
  await timed("stop", async () => stopEngine(parts, engine));
  return Object.fromEntries(times);
}

const [install] = process.argv.slice(2);
if (install === undefined) {
  process.stderr.write("Usage: packed-paper-trade.ts <folder the tarballs were installed in>\n");
  process.exit(1);
}
const parts = await openSmokeParts(install, script);
const engineStop = new AbortController();
try {
  const times = await smoke(parts, engineStop.signal);
  process.stdout.write(`${JSON.stringify({ state: "paper_filled", times })}\n`);
} catch (error) {
  const said = error instanceof Error ? error.message : String(error);
  const tunnels = [...new Set(parts.tunnels)].join(", ");
  process.stderr.write(
    `${said}\nProxy tunnels: ${tunnels}\n--- engine.log\n${await logTail(parts.home)}\n`,
  );
  process.exitCode = 1;
} finally {
  engineStop.abort();
  await parts.close();
}
