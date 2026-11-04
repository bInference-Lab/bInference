import { EventEmitter } from "node:events";
import { join } from "node:path";
import process from "node:process";
import type { Http, HttpDownload } from "@binference/core";
import {
  readFilePieces,
  readSystemFacts,
  runCommandWithin,
  type ServiceManager,
} from "@binference/platform";
import type { CliHost } from "../program/cli-host.js";
import { runCli } from "../program/run-cli.js";
import { createSystemClock } from "../runtime/system-clock.js";
import type { SystemHttp } from "../runtime/system-http.js";
import { createSystemRandom } from "../runtime/system-random.js";
import {
  createFakeReleaseRegistry,
  type FakeReleaseRegistry,
} from "../updates/fake-release-registry.js";

/**
 * What a packed smoke runs a command of the repository's sources on: an install's entry, the
 * variables every command gets, the stand-in npm registry, and the services as child processes.
 */
export interface SmokeHostWorld {
  /** The home folder the state folder sits in. */
  readonly home: string;
  /** The Node the install runs with, which the service starts the entry with. */
  readonly node: string;
  /** The installed entry script, `main.mjs` in the install's npm prefix. */
  readonly script: string;
  readonly env: Readonly<Record<string, string>>;
  readonly registry: FakeReleaseRegistry;
  readonly http: SystemHttp;
  readonly services: ServiceManager;
}

const minute = 60_000;

/** The entry script npm installs binference's package to under the global `prefix`. */
export function installedScriptOf(prefix: string): string {
  const modules = readSystemFacts().os === "win32" ? [prefix] : [prefix, "lib"];
  return join(...modules, "node_modules", "binference", "dist", "main.mjs");
}

async function bytesOf(file: string): Promise<Uint8Array> {
  const pieces: Uint8Array[] = [];
  for await (const piece of readFilePieces(file, { signal: AbortSignal.timeout(minute) })) {
    pieces.push(piece);
  }
  return new Uint8Array(Buffer.concat(pieces));
}

/** A stand-in npm registry that holds each packed tarball as the release of its version. */
export async function packedRegistryOf(
  releases: readonly { readonly version: string; readonly file: string }[],
): Promise<FakeReleaseRegistry> {
  const registry = createFakeReleaseRegistry();
  const read = await Promise.all(releases.map(async (release) => bytesOf(release.file)));
  releases.forEach((release, index) =>
    registry.release(release.version, { bytes: read[index] ?? new Uint8Array() }),
  );
  return registry;
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

// The programs an update runs, npm and the installed program, run as they are; only the installed
// program's own `start` runs here with the smoke's child services, since a smoke never touches the
// OS's login service. The service still runs the installed program's `start --foreground`.
function programsOf(world: SmokeHostWorld, version: string): NonNullable<CliHost["runProgram"]> {
  return async (file, args, options) => {
    const command = args.slice(args.indexOf(world.script) + 1);
    if (file !== world.node || command[0] !== "start") {
      return runCommandWithin(file, args, options);
    }
    const exitCode = await runCli(smokeHostOf(world, command, version));
    return { exitCode, stdout: "", stderr: "" };
  };
}

/**
 * A host for one command line of the repository's sources on the smoke's world, as `version` of
 * the install: its entry, home folder and variables, the stand-in registry and its test-signed
 * bundles, and the child services in place of the OS's login service.
 */
export function smokeHostOf(
  world: SmokeHostWorld,
  argv: readonly string[],
  version: string,
): CliHost {
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
    entry: { node: world.node, nodeOptions: [], script: world.script },
    serviceManager: world.services,
    runProgram: programsOf(world, version),
    npmRegistry: world.registry.registry,
    bundleVerifier: world.registry.verifier,
    programFolders: [],
  };
}
