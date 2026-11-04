import { EventEmitter } from "node:events";
import { join } from "node:path";
import process from "node:process";
import type { Http, HttpDownload } from "@binference/core";
import { createFakePrivy } from "@binference/custody-privy/testing";
import {
  ensureReadableFolder,
  readFilePieces,
  readSystemFacts,
  readTextFile,
  runCommandWithin,
  writeReadableFile,
} from "@binference/platform";
import { createTempFolder, type TempFolder } from "@binference/platform/testing";
import { fakeBotToken } from "@binference/telegram/testing";
import { z } from "zod";
import { newOwnerKey, rescueAddress } from "../e2e/init-fixtures.js";
import { testModelId, testModelKey } from "../e2e/model-fixtures.js";
import { freePort } from "../e2e/test-host.js";
import type { CliHost } from "../program/cli-host.js";
import { runCli } from "../program/run-cli.js";
import { createSystemClock } from "../runtime/system-clock.js";
import { createSystemHttp, type SystemHttp } from "../runtime/system-http.js";
import { createSystemRandom } from "../runtime/system-random.js";
import {
  createFakeReleaseRegistry,
  type FakeReleaseRegistry,
} from "../updates/fake-release-registry.js";
import { installArgs } from "../updates/install-tarball.js";
import { createChildServices } from "./child-services.js";
import { createPackedBinference, type PackedBinference } from "./packed-binference.js";
import { createSmokeBot } from "./smoke-bot.js";
import { startSmokeEdge } from "./smoke-edge.js";
import { startSmokeModel } from "./smoke-model.js";

// The update smoke, which `pnpm update:smoke` runs with the folder it packed three releases in:
// the old one, one whose own `check` fails and whose engine migrates the records past the old
// one's schema, and a good one. The old one installs with npm into a scratch npm prefix other
// than npm's own global one, sets up with `init --yes` in a scratch home folder and runs as the
// service, a program of this Node in place of the OS's login service. `binference update` from
// the repository's sources then installs the failing release and must put the old one and its
// records back, running, then installs the good one, which must run. npm installs the real packed tarballs;
// the update reads them from a stand-in registry, whose bundles a test signs and the update's
// verifier seam checks. Like `src/main.ts`, it reads `process`, and it moves its own `HOME` to
// the scratch folder first, so no program it runs reaches the owner's `~/.binference`.

const minute = 60_000;
const manifestSchema = z.object({
  versions: z.object({ from: z.string(), broken: z.string(), to: z.string() }),
  files: z.object({ from: z.string(), broken: z.string(), to: z.string() }),
});
type Manifest = z.infer<typeof manifestSchema>;
const statusSchema = z.looseObject({ state: z.string(), version: z.string() });

/** The smoke's world: the scratch folders, the installed program, and what each command gets. */
interface World {
  readonly scratch: TempFolder;
  readonly home: string;
  readonly prefix: string;
  readonly script: string;
  readonly env: Readonly<Record<string, string>>;
  readonly binference: PackedBinference;
  readonly registry: FakeReleaseRegistry;
  readonly http: SystemHttp;
  readonly services: ReturnType<typeof createChildServices>;
  readonly initArgs: readonly string[];
  close(): Promise<void>;
}

function fail(message: string): never {
  throw new Error(`update:smoke: ${message}`);
}

async function bytesOf(file: string): Promise<Uint8Array> {
  const pieces: Uint8Array[] = [];
  for await (const piece of readFilePieces(file, { signal: AbortSignal.timeout(minute) })) {
    pieces.push(piece);
  }
  return new Uint8Array(Buffer.concat(pieces));
}

// One of npm's settings, read before the smoke moves `HOME`.
async function npmSetting(name: "cache" | "prefix"): Promise<string> {
  const read = await runCommandWithin("npm", ["config", "get", name], {
    signal: AbortSignal.timeout(minute),
    timeoutMs: minute,
  });
  return read.stdout.trim();
}

function scriptOf(prefix: string): string {
  const modules = readSystemFacts().os === "win32" ? [prefix] : [prefix, "lib"];
  return join(...modules, "node_modules", "binference", "dist", "main.mjs");
}

// Routes the stand-in registry's origin to it, and every other request out by the route in force.
function routed(
  registry: FakeReleaseRegistry,
  http: SystemHttp,
): { http: Http; download: HttpDownload } {
  const isRegistry = (url: string) => new URL(url).origin === registry.registry;
  return {
    http: {
      request: async (request) => (isRegistry(request.url) ? registry.http : http).request(request),
    },
    download: {
      download: async (request) =>
        (isRegistry(request.url) ? registry.download : http).download(request),
    },
  };
}

// The programs the update runs, npm and the installed program, run as they are; only the installed
// program's own `start` runs here with the smoke's child services, since a smoke never touches the
// OS's login service. The service still runs the installed program's `start --foreground`.
function programsOf(world: World, version: string): NonNullable<CliHost["runProgram"]> {
  return async (file, args, options) => {
    const command = args.slice(args.indexOf(world.script) + 1);
    if (file !== process.execPath || command[0] !== "start") {
      return runCommandWithin(file, args, options);
    }
    const exitCode = await runCli(hostFor(world, command, version));
    return { exitCode, stdout: "", stderr: "" };
  };
}

/** A host for one command line of the update's sources, on the smoke's world. */
function hostFor(world: World, argv: readonly string[], version: string): CliHost {
  const { http, download } = routed(world.registry, world.http);
  return {
    argv,
    env: world.env,
    out: (text) => process.stdout.write(text),
    err: (text) => process.stderr.write(text),
    clock: createSystemClock(),
    random: createSystemRandom(),
    http,
    download,
    outbound: world.http,
    signals: new EventEmitter(),
    version,
    system: readSystemFacts(),
    homeDir: world.home,
    workerExecArgv: process.execArgv,
    entry: { node: process.execPath, nodeOptions: [], script: world.script },
    serviceManager: world.services,
    runProgram: programsOf(world, version),
    npmRegistry: world.registry.registry,
    bundleVerifier: world.registry.verifier,
    programFolders: [],
  };
}

async function statusOf(world: World): Promise<z.infer<typeof statusSchema>> {
  const status = await world.binference.run(["status", "--json"], minute);
  const line = status.stdout.split("\n").findLast((text) => text.startsWith("{")) ?? "null";
  const parsed = statusSchema.safeParse(JSON.parse(line));
  return parsed.success ? parsed.data : fail(`status printed no state:\n${status.stdout}`);
}

async function expectRunning(world: World, version: string): Promise<void> {
  const status = await statusOf(world);
  if (status.version !== version || !["ready", "locked"].includes(status.state)) {
    fail(`${version} should run, and status says ${JSON.stringify(status)}.`);
  }
}

// Runs `binference update --to` and answers its exit code and what it printed.
async function update(world: World, version: string, to: string) {
  const said: string[] = [];
  const host = hostFor(world, ["update", "--to", to, "--json"], version);
  const out = (text: string) => {
    said.push(text);
    process.stdout.write(text);
  };
  return { code: await runCli({ ...host, out }), said: said.join("") };
}

// The fakes of the outside world behind the edge's proxy, and the scripted model.
async function startFakes() {
  const privy = createFakePrivy({ clock: createSystemClock(), random: createSystemRandom() });
  const bot = createSmokeBot();
  const fakes = new Map([
    ["api.privy.io", privy.http],
    ["api.telegram.org", bot.http],
  ]);
  const edge = await startSmokeEdge(fakes, Date.now());
  const model = await startSmokeModel({ call: { name: "none", args: {} }, report: "" });
  return { privy, edge, model };
}

// The stand-in registry, holding the three packed tarballs as npm would.
async function registryOf(manifest: Manifest, folder: string): Promise<FakeReleaseRegistry> {
  const registry = createFakeReleaseRegistry();
  const names = ["from", "broken", "to"] as const;
  const read = await Promise.all(
    names.map(async (name) => bytesOf(join(folder, manifest.files[name]))),
  );
  names.forEach((name, index) =>
    registry.release(manifest.versions[name], { bytes: read[index] ?? new Uint8Array() }),
  );
  return registry;
}

function initArgsOf(fakes: Awaited<ReturnType<typeof startFakes>>): readonly string[] {
  const { privy, model } = fakes;
  return [
    ["init", "--yes", "--json", "--accept-disclaimer", "--unlock", "file"],
    ["--model-provider", "openai-compatible", "--model-base-url", model.baseUrl],
    ["--model", testModelId, "--model-key", '{ fromEnv: "SMOKE_MODEL_KEY" }'],
    ["--privy-app-id", privy.appId, "--privy-app-secret", '{ fromEnv: "SMOKE_APP_SECRET" }'],
    ["--bot-token", '{ fromEnv: "SMOKE_BOT_TOKEN" }', "--rescue", rescueAddress],
    ["--owner-key-public", newOwnerKey().publicKey, "--proxy", '{ fromEnv: "SMOKE_PROXY" }'],
  ].flat();
}

// Each command's variables: the scratch home, English words, the edge's certificate trusted, npm's
// own cache, free ports, and the secrets the flags name. This process takes the same.
async function envOf(
  scratch: TempFolder,
  fakes: Awaited<ReturnType<typeof startFakes>>,
): Promise<Readonly<Record<string, string>>> {
  const home = join(scratch.path, "h");
  const cache = await npmSetting("cache");
  const signal = AbortSignal.timeout(minute);
  await ensureReadableFolder(home, signal);
  const certFile = join(scratch.path, "edge.pem");
  await writeReadableFile(certFile, Buffer.from(fakes.edge.cert), signal);
  const moved = {
    HOME: home,
    USERPROFILE: home,
    NODE_EXTRA_CA_CERTS: certFile,
    npm_config_cache: cache,
  };
  const env = {
    ...moved,
    LANG: "en_US.UTF-8",
    BINFERENCE_ENGINE__PORT: String(await freePort()),
    BINFERENCE_ENGINE__WEBHOOK_PORT: String(await freePort()),
    SMOKE_PROXY: fakes.edge.proxyUrl,
    SMOKE_APP_SECRET: fakes.privy.appSecret.reveal(),
    SMOKE_BOT_TOKEN: fakeBotToken,
    SMOKE_MODEL_KEY: testModelKey,
    PATH: process.env["PATH"] ?? "",
  };
  // The programs `update` runs itself, npm and the new version's `check`, take this process's
  // variables, as they take the owner's shell's: the same as every other command's.
  Object.assign(process.env, env);
  delete process.env["BINFERENCE_HOME"];
  return env;
}

async function openWorld(manifest: Manifest, folder: string): Promise<World> {
  // The engine's socket sits in the state folder, and macOS binds a socket path of 104 bytes at
  // most: the scratch and home folders keep short names.
  const scratch = await createTempFolder("bnu-");
  const fakes = await startFakes();
  const globalPrefix = await npmSetting("prefix");
  const env = await envOf(scratch, fakes);
  const prefix = join(scratch.path, "npm");
  // As a one-line install into a prefix of the owner's own: the update must use the program's.
  if (prefix === globalPrefix) {
    fail("the scratch prefix is npm's own global one.");
  }
  const script = scriptOf(prefix);
  const http = createSystemHttp({ version: manifest.versions.from });
  return {
    scratch,
    home: join(scratch.path, "h"),
    prefix,
    script,
    env,
    binference: createPackedBinference({ bin: script, parentEnv: process.env, env }),
    registry: await registryOf(manifest, folder),
    http,
    services: createChildServices({ parentEnv: process.env, env }),
    initArgs: initArgsOf(fakes),
    close: async () => {
      await Promise.all([fakes.edge.close(), fakes.model.close(), http.close()]);
      await scratch.remove();
    },
  };
}

// The old release, installed by npm into the scratch prefix, set up and run as the service.
async function installOld(world: World, manifest: Manifest, folder: string): Promise<void> {
  const tarball = join(folder, manifest.files.from);
  const npm = await runCommandWithin("npm", installArgs(world.prefix, tarball), {
    signal: AbortSignal.timeout(10 * minute),
    timeoutMs: 10 * minute,
    env: world.env,
  });
  if (npm.exitCode !== 0) {
    fail(`npm could not install ${tarball}:\n${npm.stderr}`);
  }
  const init = await world.binference.run(world.initArgs, 3 * minute);
  if (init.exitCode !== 0) {
    fail(`init ended with ${String(init.exitCode)}:\n${init.stdout}`);
  }
  const started = await runCli(hostFor(world, ["start", "--json"], manifest.versions.from));
  if (started !== 0) {
    fail(`start ended with ${String(started)}.`);
  }
  await expectRunning(world, manifest.versions.from);
}

async function smoke(world: World, manifest: Manifest, folder: string): Promise<void> {
  const { from, broken, to } = manifest.versions;
  await installOld(world, manifest, folder);
  // Its engine started and migrated the records, so only its check rolls it back.
  const back = await update(world, from, broken);
  if (back.code !== 1 || !back.said.includes('"failed":"checks"')) {
    fail(`the update to ${broken}, whose check fails, did not end in a rollback after it.`);
  }
  await expectRunning(world, from);
  if ((await update(world, from, to)).code !== 0) {
    fail(`the update to ${to} did not pass.`);
  }
  await expectRunning(world, to);
  await runCli(hostFor(world, ["stop", "--json"], to));
}

async function logTail(home: string): Promise<string> {
  const log = join(home, ".binference", "logs", "engine.log");
  const read = await readTextFile(log, AbortSignal.timeout(5_000));
  return read.ok ? read.value.split("\n").slice(-60).join("\n") : "No engine log.";
}

const [folder] = process.argv.slice(2);
if (folder === undefined) {
  process.stderr.write("Usage: packed-update.ts <folder update:smoke packed the releases in>\n");
  process.exit(1);
}
const manifestRead = await readTextFile(
  join(folder, "update-smoke.json"),
  AbortSignal.timeout(5_000),
);
const manifest = manifestSchema.parse(JSON.parse(manifestRead.ok ? manifestRead.value : "null"));
const world = await openWorld(manifest, folder);
try {
  await smoke(world, manifest, folder);
  process.stdout.write(`${JSON.stringify({ state: "updated", versions: manifest.versions })}\n`);
} catch (error) {
  const said = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${said}\n--- engine.log\n${await logTail(world.home)}\n`);
  process.exitCode = 1;
} finally {
  await world.services.uninstall("binference", AbortSignal.timeout(minute));
  await world.close();
}
