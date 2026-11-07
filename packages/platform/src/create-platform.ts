import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";
import { BinferenceError, type Clock, type SecretStore } from "@binference/core";
import { walledPaths } from "./command-wall-paths.js";
import { createKeychainSecretStore } from "./keychain/keychain-secret-store.js";
import type {
  CommandWall,
  ShellLauncher,
  FileAccess,
  FilePermissions,
  IpcEndpoint,
  ServiceManager,
} from "./ports.js";
import { createLaunchdServiceManager } from "./posix/launchd-service-manager.js";
import { createLinuxCommandWall } from "./posix/linux-command-wall.js";
import { createMacosCommandWall } from "./posix/macos-command-wall.js";
import { createPosixFileAccess } from "./posix/posix-file-access.js";
import { createPosixFilePermissions } from "./posix/posix-file-permissions.js";
import { createPosixIpcEndpoint } from "./posix/posix-ipc-endpoint.js";
import { posixResidentBytes } from "./posix/posix-resident-memory.js";
import { createPosixShellLauncher } from "./posix/posix-shell-launcher.js";
import { createSystemdServiceManager } from "./posix/systemd-service-manager.js";
import { resolveStateFolder, type StateFolder, type StateFolderOptions } from "./state-folder.js";
import { createSchtasksServiceManager } from "./win32/schtasks-service-manager.js";
import { createWin32CommandWall } from "./win32/win32-command-wall.js";
import { createWin32FileAccess } from "./win32/win32-file-access.js";
import { createWin32FilePermissions } from "./win32/win32-file-permissions.js";
import { createWin32IpcEndpoint } from "./win32/win32-ipc-endpoint.js";
import { win32ResidentBytes } from "./win32/win32-resident-memory.js";
import { createWin32ShellLauncher } from "./win32/win32-shell-launcher.js";

/** What names an IPC endpoint. */
export interface IpcEndpointOptions {
  /** Such as `engine` or `signer`. */
  readonly name: string;
  /** The install's id; Windows pipe names carry it, macOS and Linux sockets do not need it. */
  readonly installId: string;
}

/** What the platform takes from the environment. The composition root reads it and passes it here. */
export interface PlatformOptions extends StateFolderOptions {
  /** The value of `XDG_CONFIG_HOME`, where Linux keeps user units; `~/.config` when empty. */
  readonly xdgConfigHome?: string | undefined;
  /** The values of `DISPLAY` and `WAYLAND_DISPLAY`: on Linux, either one names a desktop session. */
  readonly display?: string | undefined;
  readonly waylandDisplay?: string | undefined;
  /** The owner's login shell, `SHELL` on macOS and Linux, which the agent's commands run in. */
  readonly loginShell?: string | undefined;
}

/** This OS's adapters, chosen once at startup. */
export interface Platform {
  readonly stateFolder: StateFolder;
  readonly permissions: FilePermissions;
  /** Reads who can reach a path, as `binference check` reports it. */
  readonly access: FileAccess;
  /** `SIGINT` and `SIGTERM` on macOS and Linux; `SIGINT` and `SIGBREAK` on Windows. */
  readonly stopSignals: readonly NodeJS.Signals[];
  readonly ipcEndpoint: (options: IpcEndpointOptions) => IpcEndpoint;
  /** The OS keychain, entries under the service `binference`. */
  readonly keychain: SecretStore;
  /**
   * Whether a desktop session runs, so the OS keychain is there to hold secrets: always on macOS
   * and Windows, on Linux only with a display. Headless Linux and Docker have none.
   */
  readonly hasDesktopSession: boolean;
  /** This OS's service manager; the clock times its waits for a service to start or stop. */
  readonly serviceManager: (clock: Clock) => ServiceManager;
  /**
   * The resident memory of a running process in bytes, as the OS counts it: `/proc` on Linux,
   * `ps` on macOS, `tasklist` on Windows; `undefined` once it ended or when it cannot be read.
   */
  readonly residentBytes: (pid: number, signal: AbortSignal) => Promise<number | undefined>;
  /**
   * Keeps the agent's commands away from binference's own secrets (decision 0378): Seatbelt on
   * macOS, bubblewrap on Linux, and `none` on Windows, where the shell is off outside the image.
   */
  readonly commandWall: CommandWall;
  /**
   * Runs the agent's commands in this OS's shell behind {@link commandWall} (decision 0378); the
   * clock times each command's limit.
   */
  readonly shellLauncher: (clock: Clock) => ShellLauncher;
}

type ServiceManagerOf = Platform["serviceManager"];

function posixServiceManager(
  options: PlatformOptions,
  permissions: FilePermissions,
): ServiceManagerOf {
  const home = options.homeDir ?? homedir();
  if (process.platform === "darwin") {
    const agentsFolder = join(home, "Library", "LaunchAgents");
    const uid = process.getuid?.() ?? 0;
    return (clock) => createLaunchdServiceManager({ clock, agentsFolder, uid, permissions });
  }
  // The XDG spec has a relative XDG_CONFIG_HOME ignored.
  const configHome = options.xdgConfigHome ?? "";
  const unitFolder = join(
    isAbsolute(configHome) ? configHome : join(home, ".config"),
    "systemd",
    "user",
  );
  return () => createSystemdServiceManager({ unitFolder, permissions });
}

function hasDisplay(options: PlatformOptions): boolean {
  return (options.display ?? "") !== "" || (options.waylandDisplay ?? "") !== "";
}

/**
 * Picks the adapters for the OS this process runs on. Throws `platform.unsupported_os` on any OS
 * but macOS, Linux and Windows.
 */
export function createPlatform(options: PlatformOptions = {}): Platform {
  const stateFolder = resolveStateFolder(options);
  const keychain = createKeychainSecretStore();
  const walled = walledPaths(stateFolder);
  if (process.platform === "win32") {
    const win32Wall = createWin32CommandWall();
    return {
      stateFolder,
      permissions: createWin32FilePermissions(),
      access: createWin32FileAccess(),
      stopSignals: ["SIGINT", "SIGBREAK"],
      ipcEndpoint: (endpoint) => createWin32IpcEndpoint(endpoint),
      keychain,
      hasDesktopSession: true,
      serviceManager: (clock) => createSchtasksServiceManager({ clock }),
      residentBytes: win32ResidentBytes,
      commandWall: win32Wall,
      shellLauncher: (clock) => createWin32ShellLauncher(win32Wall, clock),
    };
  }
  if (process.platform === "darwin" || process.platform === "linux") {
    const permissions = createPosixFilePermissions();
    const posixWall =
      process.platform === "darwin"
        ? createMacosCommandWall(walled)
        : createLinuxCommandWall(walled);
    return {
      stateFolder,
      permissions,
      access: createPosixFileAccess(),
      stopSignals: ["SIGINT", "SIGTERM"],
      ipcEndpoint: ({ name }) =>
        createPosixIpcEndpoint({ runFolder: stateFolder.run, name, permissions }),
      keychain,
      hasDesktopSession: process.platform === "darwin" || hasDisplay(options),
      serviceManager: posixServiceManager(options, permissions),
      residentBytes: posixResidentBytes,
      commandWall: posixWall,
      shellLauncher: (clock) =>
        createPosixShellLauncher(posixWall, { loginShell: options.loginShell, clock }),
    };
  }
  throw new BinferenceError({
    code: "platform.unsupported_os",
    message: `binference runs on macOS, Linux and Windows, not ${process.platform}.`,
    details: { os: process.platform },
  });
}
