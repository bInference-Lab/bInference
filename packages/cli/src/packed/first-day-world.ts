import { delimiter, dirname, join } from "node:path";
import process from "node:process";
import { BinferenceError } from "@binference/core";
import {
  type ProgramExit,
  readSystemFacts,
  readTextFile,
  runCommandWithin,
  writeReadableFile,
} from "@binference/platform";
import { fakeBotToken } from "@binference/telegram/testing";
import { z } from "zod";
import { rescueAddress } from "../e2e/init-fixtures.js";
import { testModelId, testModelKey } from "../e2e/model-fixtures.js";
import { freePort } from "../e2e/test-host.js";
import { createSystemHttp } from "../runtime/system-http.js";
import { createChildServices } from "./child-services.js";
import { type FirstDayPaths, firstDayPaths } from "./first-day-checks.js";
import type { FirstDayPrivy } from "./first-day-privy.js";
import { createSmokeBot, type SmokeBot } from "./smoke-bot.js";
import { paperTradeScript } from "./smoke-chat.js";
import { startSmokeEdge } from "./smoke-edge.js";
import { installedScriptOf, packedRegistryOf, type SmokeHostWorld } from "./smoke-host.js";
import { startSmokeModel } from "./smoke-model.js";

/**
 * The two releases of the first day and the commit they were packed from, as `first-day.json` in
 * the packed folder names them.
 */
const packedSchema = z.object({
  versions: z.object({ from: z.string(), to: z.string() }),
  files: z.object({ from: z.string(), to: z.string() }),
  commit: z.string(),
});

/** Where the orchestrator put the packed releases, the one-liner's home, and the guard. */
export interface FirstDayFolders {
  readonly packed: string;
  /** The one-liner's scratch folder: `home/`, `tmp/` and `npm-cache/` in it. */
  readonly scratch: string;
  /** The folder of stand-ins for the OS's service tools, and their `guard.log`. */
  readonly guard: string;
}

/** The first day's world: the install's paths, the fakes, and what each command gets. */
export interface FirstDayWorld extends SmokeHostWorld {
  readonly os: string;
  readonly paths: FirstDayPaths;
  readonly versions: { readonly from: string; readonly to: string };
  /** The commit both releases were packed from, which the sources must be at. */
  readonly packedCommit: string;
  readonly bot: SmokeBot;
  /** The fake Privy or its dev app, the owner key init names, and the dev app's cleanup. */
  readonly privy: FirstDayPrivy;
  /** The `BINFERENCE_INIT_*` answers of `init --yes`; each secret is a source, never a value. */
  readonly initAnswers: Readonly<Record<string, string>>;
  readonly guardLog: string;
  close(): Promise<void>;
}

// The fakes of the outside world behind the edge's proxy: the synthetic Bot API, Privy's fake
// unless the day runs on its dev app, then the scripted model.
async function startFakes(privy: FirstDayPrivy) {
  const bot = createSmokeBot();
  const fakes = new Map([
    ["api.telegram.org", bot.http],
    ...(privy.fake === undefined ? [] : ([["api.privy.io", privy.fake]] as const)),
  ]);
  const edge = await startSmokeEdge(fakes, Date.now());
  const model = await startSmokeModel(paperTradeScript);
  return { bot, edge, model, privy };
}

type Fakes = Awaited<ReturnType<typeof startFakes>>;

// The answers init reads from its variables, the secrets as sources of the variables below.
function initAnswersOf(fakes: Fakes): Readonly<Record<string, string>> {
  return {
    BINFERENCE_INIT_ACCEPT_DISCLAIMER: "true",
    BINFERENCE_INIT_UNLOCK: "file",
    BINFERENCE_INIT_PROXY: '{ fromEnv: "SMOKE_PROXY" }',
    BINFERENCE_INIT_MODEL_PROVIDER: "openai-compatible",
    BINFERENCE_INIT_MODEL_BASE_URL: fakes.model.baseUrl,
    BINFERENCE_INIT_MODEL: testModelId,
    BINFERENCE_INIT_MODEL_KEY: '{ fromEnv: "SMOKE_MODEL_KEY" }',
    BINFERENCE_INIT_PRIVY_APP_ID: fakes.privy.appId,
    BINFERENCE_INIT_PRIVY_APP_SECRET: '{ fromEnv: "SMOKE_APP_SECRET" }',
    BINFERENCE_INIT_OWNER_KEY_PUBLIC: fakes.privy.ownerKeyPublic,
    BINFERENCE_INIT_RESCUE: rescueAddress,
    BINFERENCE_INIT_BOT_TOKEN: '{ fromEnv: "SMOKE_BOT_TOKEN" }',
  };
}

// The Node the install script put in its data folder, which the launcher runs.
function pinnedNodeOf(paths: FirstDayPaths, os: string): string {
  const current = join(paths.node, "current");
  return os === "win32" ? join(current, "node.exe") : join(current, "bin", "node");
}

// The one-liner's home and folders, the edge's certificate trusted, free ports, the secrets the
// answers name, and the stand-ins first on PATH, then the install's Node, as the launcher puts it.
async function envOf(
  folders: FirstDayFolders,
  fakes: Fakes,
  node: string,
): Promise<Readonly<Record<string, string>>> {
  const home = join(folders.scratch, "home");
  const certFile = join(folders.scratch, "edge.pem");
  await writeReadableFile(certFile, Buffer.from(fakes.edge.cert), AbortSignal.timeout(10_000));
  const local = join(home, "AppData", "Local");
  return {
    HOME: home,
    USERPROFILE: home,
    LOCALAPPDATA: local,
    APPDATA: join(home, "AppData", "Roaming"),
    TMPDIR: join(folders.scratch, "tmp"),
    npm_config_cache: join(folders.scratch, "npm-cache"),
    LANG: "en_US.UTF-8",
    NODE_EXTRA_CA_CERTS: certFile,
    BINFERENCE_ENGINE__PORT: String(await freePort()),
    BINFERENCE_ENGINE__WEBHOOK_PORT: String(await freePort()),
    SMOKE_PROXY: fakes.edge.proxyUrl,
    SMOKE_APP_SECRET: fakes.privy.appSecret,
    SMOKE_BOT_TOKEN: fakeBotToken,
    SMOKE_MODEL_KEY: testModelKey,
    PATH: [folders.guard, dirname(node), process.env["PATH"] ?? ""].join(delimiter),
  };
}

/**
 * Opens the first day's world on the one-liner's home: the fakes, the stand-in registry with both
 * packed releases, and the child services. Every program it runs, and this process, gets the
 * world's variables and no `BINFERENCE_HOME`, as an owner's shell has.
 */
export async function openFirstDay(
  folders: FirstDayFolders,
  privy: FirstDayPrivy,
): Promise<FirstDayWorld> {
  const signal = AbortSignal.timeout(10_000);
  const read = await readTextFile(join(folders.packed, "first-day.json"), signal);
  const packed = packedSchema.parse(JSON.parse(read.ok ? read.value : "null"));
  const { os } = readSystemFacts();
  const paths = firstDayPaths(join(folders.scratch, "home"), os);
  const node = pinnedNodeOf(paths, os);
  const fakes = await startFakes(privy);
  const env = await envOf(folders, fakes, node);
  Object.assign(process.env, env);
  delete process.env["BINFERENCE_HOME"];
  delete process.env["XDG_DATA_HOME"];
  const http = createSystemHttp({ version: packed.versions.from });
  const releases = (["from", "to"] as const).map((name) => ({
    version: packed.versions[name],
    file: join(folders.packed, packed.files[name]),
  }));
  return {
    os,
    paths,
    versions: packed.versions,
    packedCommit: packed.commit,
    home: join(folders.scratch, "home"),
    node,
    script: installedScriptOf(paths.program),
    env,
    registry: await packedRegistryOf(releases),
    http,
    services: createChildServices({ parentEnv: process.env, env }),
    bot: fakes.bot,
    privy: fakes.privy,
    initAnswers: initAnswersOf(fakes),
    guardLog: join(folders.guard, "guard.log"),
    close: async () => {
      await Promise.all([fakes.edge.close(), fakes.model.close(), http.close()]);
    },
  };
}

// The commands the smoke runs through the installed launcher: none of them reaches the OS's
// service manager. `start`, `update` and `uninstall` run from the sources on the child services
// instead.
const launcherCommands: ReadonlySet<string> = new Set(["init", "status", "--version"]);

/**
 * Runs one command through the launcher the install script wrote, as the owner types it, with the
 * world's variables and `extra` on top; `cmd.exe` runs it on Windows. Refuses any command that
 * could reach the OS's service manager.
 */
export async function runLauncher(
  world: FirstDayWorld,
  args: readonly string[],
  extra: Readonly<Record<string, string>> = {},
): Promise<ProgramExit> {
  if (!launcherCommands.has(args[0] ?? "")) {
    throw new BinferenceError({
      code: "smoke.service_guard",
      message: `The smoke never runs binference ${args.join(" ")} through the launcher.`,
    });
  }
  const { launcher } = world.paths;
  const [file, line] =
    world.os === "win32" ? ["cmd.exe", ["/d", "/c", launcher, ...args]] : [launcher, args];
  const budgetMs = 3 * 60_000;
  return runCommandWithin(file, line, {
    signal: AbortSignal.timeout(budgetMs),
    timeoutMs: budgetMs,
    env: { ...world.env, ...extra },
  });
}
