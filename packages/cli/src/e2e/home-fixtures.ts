import { join } from "node:path";
import type { TempFolder } from "@binference/platform/testing";
import {
  type CliRun,
  type InitMachine,
  initFlags,
  newInitMachine,
  runOn,
  secretEnv,
} from "./init-fixtures.js";
import { freePort, type HostParts, hostWith } from "./test-host.js";
import { createTestServices, type TestServices } from "./test-services.js";
import { createTestSigner } from "./test-signer.js";

/**
 * A machine set up by `binference init` whose state folder is `.binference` in its home folder, as
 * the background service runs it, with the test's service manager and an engine port of its own.
 */
export interface Home {
  readonly machine: InitMachine;
  /** The home folder the state folder sits in. */
  readonly home: string;
  readonly services: TestServices;
  readonly port: number;
}

/** The variables of a run on the home's state folder: the secrets, and no `BINFERENCE_HOME`. */
export function homeEnv(machine: InitMachine): Readonly<Record<string, string>> {
  return { ...secretEnv(machine), BINFERENCE_HOME: "" };
}

/** Sets up a home with `binference init`, and hands its folder to `folders` for cleanup. */
export async function setUpHome(folders: TempFolder[]): Promise<Home> {
  const base = await newInitMachine(folders);
  const machine = { ...base, folder: join(base.folder, ".binference") };
  const init = await runOn(machine, ["init", "--yes", ...initFlags(machine)]);
  if (init.code !== 0) {
    throw new Error(`binference init failed: ${init.stderr}`);
  }
  const services = createTestServices({
    script: join(machine.folder, "bin", "binference.mjs"),
    signals: machine.signals,
    host: (argv) =>
      hostWith(machine, argv, {
        env: homeEnv(machine),
        parts: { http: machine.world, startSigner: createTestSigner().start, homeDir: base.folder },
      }),
  });
  return { machine, home: base.folder, services, port: await freePort() };
}

/** Runs a command line on the home, with its service manager and what the test adds. */
export async function onHome(
  home: Home,
  argv: readonly string[],
  parts: HostParts = {},
): Promise<CliRun> {
  return runOn(home.machine, argv, {
    env: homeEnv(home.machine),
    parts: { homeDir: home.home, serviceManager: home.services.manager, ...parts },
  });
}

/** Starts the engine as the home's background service, on the home's port. */
export async function startService(home: Home): Promise<void> {
  const started = await onHome(home, ["start", "--json", ...portSet(home)]);
  if (started.code !== 0) {
    throw new Error(`binference start failed: ${started.stderr}`);
  }
}

/** The `--set` that keeps the engine on the home's port when a command starts it again. */
export function portSet(home: Home): readonly string[] {
  return ["--set", `engine.port=${String(home.port)}`];
}
