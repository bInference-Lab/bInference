import { mkdir, rm } from "node:fs/promises";
import { join, posix } from "node:path";
import { err, ok, type Result } from "@binference/core";
import type { FilePermissions, ServiceManager } from "../ports.js";
import { writePrivateFile } from "../private-files.js";
import { runCommandToExit, type ProgramExit, type RunToExit } from "../run-command.js";
import {
  checkServiceDefinition,
  checkServiceName,
  type ServiceDefinition,
  type ServiceStatus,
} from "../service/service-definition.js";
import { serviceFailed } from "../service/service-failed.js";
import { createPosixFilePermissions } from "./posix-file-permissions.js";
import { renderSystemdUnit, systemdUnitName } from "./systemd-unit.js";

/** Where the Linux adapter keeps its units, and what it runs `systemctl` with. */
export interface SystemdServiceManagerOptions {
  /** `$XDG_CONFIG_HOME/systemd/user`, which is `~/.config/systemd/user` by default. */
  readonly unitFolder: string;
  /** `runCommandToExit` when left out; tests pass a recorder. */
  readonly run?: RunToExit;
  /** POSIX modes when left out. */
  readonly permissions?: FilePermissions;
}

interface Systemd {
  readonly unitFolder: string;
  readonly run: RunToExit;
  readonly permissions: FilePermissions;
}

const unitFileOf = (systemd: Systemd, name: string): string =>
  join(systemd.unitFolder, systemdUnitName(name));

async function systemctl(
  systemd: Systemd,
  args: readonly string[],
  signal: AbortSignal,
): Promise<ProgramExit> {
  const exit = await systemd.run("systemctl", ["--user", ...args], signal);
  if (exit.exitCode !== 0) {
    throw serviceFailed(
      `systemctl --user ${args.join(" ")} failed; the user manager runs only in a login ` +
        "session, or with lingering on (loginctl enable-linger).",
      exit,
    );
  }
  return exit;
}

// `systemctl show` prints one `Key=value` line per property it was asked for.
function readProperties(text: string): ReadonlyMap<string, string> {
  return new Map(
    text
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.includes("="))
      .map((line) => [line.slice(0, line.indexOf("=")), line.slice(line.indexOf("=") + 1)]),
  );
}

async function status(systemd: Systemd, name: string, signal: AbortSignal): Promise<ServiceStatus> {
  checkServiceName(name);
  signal.throwIfAborted();
  const args = ["show", systemdUnitName(name), "--property=LoadState,ActiveState,UnitFileState"];
  const properties = readProperties((await systemctl(systemd, args, signal)).stdout);
  if (properties.get("LoadState") === "not-found") {
    return { state: "not_installed" };
  }
  return {
    state: properties.get("ActiveState") === "active" ? "running" : "stopped",
    startsAtLogin: properties.get("UnitFileState") === "enabled",
  };
}

async function install(
  systemd: Systemd,
  definition: ServiceDefinition,
  signal: AbortSignal,
): Promise<void> {
  checkServiceDefinition(definition, posix.isAbsolute);
  signal.throwIfAborted();
  const unit = systemdUnitName(definition.name);
  await mkdir(systemd.unitFolder, { recursive: true });
  const files = { permissions: systemd.permissions, signal };
  await writePrivateFile(
    unitFileOf(systemd, definition.name),
    renderSystemdUnit(definition),
    files,
  );
  await systemctl(systemd, ["daemon-reload"], signal);
  await systemctl(systemd, ["enable", unit], signal);
  // A restart starts a stopped unit and replaces a running one with the new definition.
  await systemctl(systemd, ["restart", unit], signal);
  if ((await status(systemd, definition.name, signal)).state !== "running") {
    throw serviceFailed(`systemd started ${unit} but it does not run; read its log file.`);
  }
}

async function uninstall(
  systemd: Systemd,
  name: string,
  signal: AbortSignal,
): Promise<Result<void, "not_installed">> {
  if ((await status(systemd, name, signal)).state === "not_installed") {
    return err("not_installed");
  }
  const unit = systemdUnitName(name);
  await systemctl(systemd, ["disable", "--now", unit], signal);
  await rm(unitFileOf(systemd, name), { force: true });
  await systemctl(systemd, ["daemon-reload"], signal);
  // A unit that failed stays listed until its failure is cleared; one that did not fail answers
  // with an error here, which changes nothing.
  await systemd.run("systemctl", ["--user", "reset-failed", unit], signal);
  return ok(undefined);
}

/**
 * Services as units of the owner's systemd user manager on Linux (`systemctl --user`): a unit file
 * in `unitFolder`, enabled for `default.target`, so it starts when the owner logs in. On a server
 * with no login session the user manager runs only with lingering on (`loginctl enable-linger`).
 */
export function createSystemdServiceManager(options: SystemdServiceManagerOptions): ServiceManager {
  const systemd: Systemd = {
    unitFolder: options.unitFolder,
    run: options.run ?? runCommandToExit,
    permissions: options.permissions ?? createPosixFilePermissions(),
  };
  return {
    install: async (definition, signal) => install(systemd, definition, signal),
    uninstall: async (name, signal) => uninstall(systemd, name, signal),
    status: async (name, signal) => status(systemd, name, signal),
  };
}
