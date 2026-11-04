import { join } from "node:path";
import { type HttpRequest, type JsonValue, jsonValueSchema } from "@binference/core";
import { listFolderFiles, type ProgramExit } from "@binference/platform";
import type { TempFolder } from "@binference/platform/testing";
import type { ReleaseNotes } from "@binference/protocol";
import { engineWorker, openDatabase } from "@binference/store";
import { migratePastThisBuild } from "@binference/store/newer-schema";
import { runCli } from "../program/run-cli.js";
import {
  createFakeReleaseRegistry,
  type FakeReleaseRegistry,
} from "../updates/fake-release-registry.js";
import {
  type CliRun,
  type InitMachine,
  initFlags,
  newInitMachine,
  runOn,
  secretEnv,
} from "./init-fixtures.js";
import { connectClient, freePort, type HostParts, hostWith } from "./test-host.js";
import { createTestServices, type TestServices } from "./test-services.js";
import { createTestSigner } from "./test-signer.js";

/** The version the machine runs before an update, and the release it updates to. */
export const running = "2026.10.0-test";
export const newer = "2026.11.0";
const notes: ReleaseNotes = {
  en: ["Stop-loss orders fill faster."],
  zh: ["The Chinese line."],
};

/** How the new version behaves while `binference update` judges it. */
export interface Verdict {
  readonly check: "fails" | "passes";
  /**
   * Whether the new version's engine migrates `engine.sqlite` past the old version's schema, as a
   * release with a new engine migration does; the test marks it while the new engine runs.
   */
  readonly migrates?: boolean;
}

/** A machine whose engine runs as the service from an npm prefix, and the programs it ran. */
export interface UpdateHome {
  readonly machine: InitMachine;
  readonly home: string;
  /** The npm prefix the program runs from, which is never npm's own global one. */
  readonly prefix: string;
  readonly services: TestServices;
  readonly registry: FakeReleaseRegistry;
  readonly parts: HostParts;
  /** The engine's port, which every start keeps through `--set`. */
  readonly port: string;
  /** The version npm installed last, which the service's program runs. */
  readonly installed: { version: string };
  /** Each npm command line, each command of the installed program, each state checked. */
  readonly npm: string[][];
  readonly commands: string[][];
  readonly checkedStates: JsonValue[];
}

const envOf = (machine: InitMachine) => ({ ...secretEnv(machine), BINFERENCE_HOME: "" });

/** The last JSON line a command printed: the commands an update runs print their own before it. */
export function lastJson(stdout: string): JsonValue {
  return jsonValueSchema.parse(JSON.parse(stdout.trim().split("\n").at(-1) ?? ""));
}

// The machine's world, with the fake registry's origin answered by the registry.
function worldOf(machine: InitMachine, registry: FakeReleaseRegistry) {
  const origin = new URL(registry.registry).origin;
  return {
    request: async (request: HttpRequest) =>
      new URL(request.url).origin === origin
        ? registry.http.request(request)
        : machine.world.request(request),
  };
}

/** The schema version `engine.sqlite` records, read as SQLite stores it. */
export async function engineSchemaOf(home: UpdateHome): Promise<number> {
  const database = await openDatabase({
    file: join(home.machine.folder, "engine.sqlite"),
    worker: engineWorker,
    readers: 0,
    execArgv: hostWith(home.machine, [], { env: {} }).workerExecArgv ?? [],
    signal: AbortSignal.timeout(20_000),
  });
  try {
    return database.schemaVersion;
  } finally {
    await database.close();
  }
}

/**
 * Migrates `engine.sqlite` one schema past this build, as a newer release's engine migration does:
 * a table of its own and a higher schema version, which the old build then refuses to open.
 */
export function migrateEnginePastThisBuild(home: UpdateHome): void {
  migratePastThisBuild(join(home.machine.folder, "engine.sqlite"));
}

/** Runs a command on the home's machine, as the program installed there. */
export async function cli(home: UpdateHome, argv: readonly string[]): Promise<CliRun> {
  return runOn(home.machine, argv, { env: envOf(home.machine), parts: home.parts });
}

/** Runs a command as the given version of the program, such as the one npm left on disk. */
export async function cliAs(
  home: UpdateHome,
  version: string,
  argv: readonly string[],
): Promise<CliRun> {
  const host = {
    ...hostWith(home.machine, argv, { env: envOf(home.machine), parts: home.parts }),
    version,
  };
  const code = await runCli(host);
  return { code, stdout: host.stdout(), stderr: host.stderr() };
}

// The installed program's own commands: `start` runs as this machine's `binference start`, a
// check with `--fix` finds nothing, and the check is the verdict.
async function installedCommand(
  home: UpdateHome,
  command: readonly string[],
  verdict: Verdict,
): Promise<ProgramExit> {
  if (command[0] === "start") {
    const started = await cli(home, command);
    return { exitCode: started.code, stdout: started.stdout, stderr: started.stderr };
  }
  if (command.includes("--fix")) {
    return { exitCode: 0, stdout: `${JSON.stringify({ findings: [] })}\n`, stderr: "" };
  }
  const status = await runOn(home.machine, ["status", "--json"], {
    env: envOf(home.machine),
    parts: { homeDir: home.home },
  });
  home.checkedStates.push(lastJson(status.stdout));
  if (verdict.migrates === true) {
    migrateEnginePastThisBuild(home);
  }
  const isBroken = verdict.check === "fails";
  const findings = isBroken ? [{ check: "test.broken", level: "fail" }] : [];
  return { exitCode: isBroken ? 1 : 0, stdout: `${JSON.stringify({ findings })}\n`, stderr: "" };
}

// npm installs whichever kept tarball it is given; any other program is the installed binference.
function programsOf(home: () => UpdateHome, verdict: Verdict) {
  return async (file: string, args: readonly string[]): Promise<ProgramExit> => {
    const at = home();
    if (file === "npm") {
      at.npm.push([...args]);
      at.installed.version = /binference-(.+)\.tgz$/.exec(args.at(-1) ?? "")?.[1] ?? "";
      return { exitCode: 0, stdout: "", stderr: "" };
    }
    const command = args.slice(args.indexOf(at.parts.entry?.script ?? "") + 1);
    at.commands.push(command);
    return installedCommand(at, command, verdict);
  };
}

// The home once it is set up: its programs run only after that.
function reached(holder: { readonly home?: UpdateHome }): UpdateHome {
  if (holder.home === undefined) {
    throw new Error("The update home is not set up yet.");
  }
  return holder.home;
}

// A machine `binference init` set up in `.binference` of its home, and the registry it reads.
async function initMachine(folders: TempFolder[]) {
  const base = await newInitMachine(folders);
  const machine = { ...base, folder: join(base.folder, ".binference") };
  const init = await runOn(machine, ["init", "--yes", ...initFlags(machine)]);
  if (init.code !== 0) {
    throw new Error(`binference init failed: ${init.stderr}`);
  }
  const registry = createFakeReleaseRegistry();
  registry.release(running);
  registry.release(newer, { notes });
  registry.tag("latest", newer);
  return { base, machine, registry };
}

/**
 * A machine set up by `binference init`, whose program runs from a scratch npm prefix, with a fake
 * registry holding the running release and a newer one with notes, and its service the test's.
 */
export async function setUpHome(folders: TempFolder[], verdict: Verdict): Promise<UpdateHome> {
  const { base, machine, registry } = await initMachine(folders);
  const prefix = join(base.folder, "npm");
  const script = join(prefix, "lib", "node_modules", "binference", "dist", "main.mjs");
  const entry = { node: join(base.folder, "bin", "node"), nodeOptions: [], script };
  const installed = { version: running };
  const world = worldOf(machine, registry);
  const services = createTestServices({
    script,
    signals: machine.signals,
    host: (argv) => ({
      ...hostWith(machine, argv, {
        env: envOf(machine),
        parts: { http: world, startSigner: createTestSigner().start, homeDir: base.folder, entry },
      }),
      version: installed.version,
    }),
  });
  const holder: { home?: UpdateHome } = {};
  const parts: HostParts = {
    homeDir: base.folder,
    serviceManager: services.manager,
    runProgram: programsOf(() => reached(holder), verdict),
    http: world,
    download: registry.download,
    npmRegistry: registry.registry,
    bundleVerifier: registry.verifier,
    entry,
  };
  const port = String(await freePort());
  holder.home = {
    machine,
    home: base.folder,
    prefix,
    services,
    registry,
    parts,
    port,
    installed,
    npm: [],
    commands: [],
    checkedStates: [],
  };
  return holder.home;
}

/** Starts the home's engine as the service, on its own port. */
export async function startService(home: UpdateHome): Promise<CliRun> {
  return cli(home, ["start", "--json", "--set", `engine.port=${home.port}`]);
}

/** Runs `binference update` with the home's port kept through `--set`, and any flags given. */
export async function update(home: UpdateHome, flags: readonly string[] = []): Promise<CliRun> {
  return cli(home, ["update", "--json", "--set", `engine.port=${home.port}`, ...flags]);
}

/** The keys of the update notices the engine stored, oldest first. */
export async function updateKeys(home: UpdateHome): Promise<readonly string[]> {
  const client = await connectClient(home.machine);
  const page = await client.call(
    "notice/list",
    { limit: 200 },
    { signal: AbortSignal.timeout(20_000) },
  );
  client.close();
  return page.items.map((item) => item.key).filter((key) => key.startsWith("notice.update"));
}

/** Whether a file or folder the update keeps is still in `updates/`. */
export async function isKept(home: UpdateHome, name: string): Promise<boolean> {
  const signal = AbortSignal.timeout(5_000);
  const files = await listFolderFiles(join(home.machine.folder, "updates"), signal);
  return files.some((file) => file === name || file.startsWith(`${name}/`));
}
