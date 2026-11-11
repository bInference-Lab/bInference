import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";
import { BinferenceError, type Clock, type SecretStore } from "@binference/core";
import { firstProgram } from "./browser-programs.js";
import { walledPaths } from "./command-wall-paths.js";
import { createKeychainSecretStore } from "./keychain/keychain-secret-store.js";
import type {
  CommandWall,
  ShellLauncher,
  FileAccess,
  FilePermissions,
  IpcEndpoint,
  ScreenCapture,
  ServiceManager,
} from "./ports.js";
import { createImageShellLauncher } from "./posix/image-shell-launcher.js";
import { imageShellLayout } from "./posix/image-shell.js";
import { createLaunchdServiceManager } from "./posix/launchd-service-manager.js";
import { createLinuxCommandWall } from "./posix/linux-command-wall.js";
import { createLinuxScreenCapture } from "./posix/linux-screen-capture.js";
import { createMacosCommandWall } from "./posix/macos-command-wall.js";
import { createMacosScreenCapture } from "./posix/macos-screen-capture.js";
import { osUserWall } from "./posix/os-user-wall.js";
import { linuxBrowserPrograms, macBrowserPrograms } from "./posix/posix-browser-programs.js";
import { createPosixFileAccess } from "./posix/posix-file-access.js";
import { createPosixFilePermissions } from "./posix/posix-file-permissions.js";
import { createPosixIpcEndpoint } from "./posix/posix-ipc-endpoint.js";
import { posixResidentBytes } from "./posix/posix-resident-memory.js";
import { createPosixShellLauncher } from "./posix/posix-shell-launcher.js";
import { shareWorkspace } from "./posix/share-workspace.js";
import { createSystemdServiceManager } from "./posix/systemd-service-manager.js";
import type { ScreenCaptureOptions } from "./screen-shots.js";
import { resolveStateFolder, type StateFolder, type StateFolderOptions } from "./state-folder.js";
import { createSchtasksServiceManager } from "./win32/schtasks-service-manager.js";
import { windowsBrowserPrograms } from "./win32/win32-browser-programs.js";
import { createWin32CommandWall } from "./win32/win32-command-wall.js";
import { createWin32FileAccess } from "./win32/win32-file-access.js";
import { createWin32FilePermissions } from "./win32/win32-file-permissions.js";
import { createWin32IpcEndpoint } from "./win32/win32-ipc-endpoint.js";
import { win32ResidentBytes } from "./win32/win32-resident-memory.js";
import { createWin32ScreenCapture } from "./win32/win32-screen-capture.js";
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
  /**
   * The value of `BINFERENCE_SHELL_LAUNCHER`, which the Docker image sets: the socket of the
   * image's shell launcher, which runs the agent's commands as a user of their own (decision
   * 0412). Empty or left out means the OS's command wall.
   */
  readonly shellLauncher?: string | undefined;
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
   * macOS, bubblewrap on Linux, `none` on Windows, where the shell is off outside the image, and in
   * the Docker image the OS user its shell launcher runs commands as (decision 0412).
   */
  readonly commandWall: CommandWall;
  /**
   * Runs the agent's commands in this OS's shell behind {@link commandWall} (decision 0378), or
   * through the image's shell launcher (decision 0412); the clock times each command's limit.
   */
  readonly shellLauncher: (clock: Clock) => ShellLauncher;
  /**
   * In the Docker image only: gives the workspace the group of the user the agent's commands run
   * as, and the mode both write it with, when a restore or a bound folder left it otherwise
   * (decision 0412). Throws `platform.share_failed` when it cannot.
   */
  readonly shareWorkspace?: (signal: AbortSignal) => Promise<void>;
  /**
   * The program of a Chrome-family browser installed on this machine, the agent's browser
   * (decision 0401): Google Chrome, Microsoft Edge, Brave, then Chromium, where this OS installs
   * them; `undefined` when none is there.
   */
  readonly findBrowser: () => string | undefined;
  /**
   * Takes screenshots of the owner's screen with this OS's own program (decision 0406):
   * `screencapture` on macOS, the first of `grim`, `gnome-screenshot` and `scrot` on Linux with a
   * desktop session, and Windows PowerShell through .NET on Windows.
   */
  readonly screenCapture: (options: ScreenCaptureOptions) => ScreenCapture;
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

// Where macOS or Linux installs a Chrome-family browser.
function posixBrowserPrograms(options: PlatformOptions): readonly string[] {
  return process.platform === "darwin"
    ? macBrowserPrograms(options.homeDir ?? homedir())
    : linuxBrowserPrograms;
}

function hasDisplay(options: PlatformOptions): boolean {
  return (options.display ?? "") !== "" || (options.waylandDisplay ?? "") !== "";
}

// The screenshot programs of macOS, or Linux's with a desktop session.
function posixScreenCapture(options: PlatformOptions): Platform["screenCapture"] {
  return (screen) =>
    process.platform === "darwin"
      ? createMacosScreenCapture({ ...screen, hasScreen: true })
      : createLinuxScreenCapture({ ...screen, hasScreen: hasDisplay(options) });
}

// The agent's shell on macOS and Linux: the image's shell launcher, whose user is the wall, when
// the image names its socket (decision 0412); else the OS's command wall around the owner's shell.
function posixShell(
  options: PlatformOptions,
  stateFolder: StateFolder,
): Pick<Platform, "commandWall" | "shellLauncher" | "shareWorkspace"> {
  const socket = options.shellLauncher ?? "";
  if (socket !== "") {
    const { home, group } = imageShellLayout;
    return {
      commandWall: osUserWall,
      shellLauncher: (clock) => createImageShellLauncher({ socket, home, clock }),
      shareWorkspace: async (signal) => shareWorkspace(stateFolder.workspace, group, signal),
    };
  }
  const walled = walledPaths(stateFolder);
  const wall =
    process.platform === "darwin" ? createMacosCommandWall(walled) : createLinuxCommandWall(walled);
  return {
    commandWall: wall,
    shellLauncher: (clock) =>
      createPosixShellLauncher(wall, { loginShell: options.loginShell, clock }),
  };
}

// Windows' adapters, around the state folder and the keychain every OS shares.
function win32Platform(
  options: PlatformOptions,
  shared: Pick<Platform, "stateFolder" | "keychain">,
): Platform {
  const win32Wall = createWin32CommandWall();
  return {
    ...shared,
    permissions: createWin32FilePermissions(),
    access: createWin32FileAccess(),
    stopSignals: ["SIGINT", "SIGBREAK"],
    ipcEndpoint: (endpoint) => createWin32IpcEndpoint(endpoint),
    hasDesktopSession: true,
    serviceManager: (clock) => createSchtasksServiceManager({ clock }),
    residentBytes: win32ResidentBytes,
    commandWall: win32Wall,
    shellLauncher: (clock) => createWin32ShellLauncher(win32Wall, clock),
    findBrowser: () => firstProgram(windowsBrowserPrograms(options.homeDir ?? homedir())),
    screenCapture: (screen) => createWin32ScreenCapture({ ...screen, hasScreen: true }),
  };
}

/**
 * Picks the adapters for the OS this process runs on. Throws `platform.unsupported_os` on any OS
 * but macOS, Linux and Windows.
 */
export function createPlatform(options: PlatformOptions = {}): Platform {
  const stateFolder = resolveStateFolder(options);
  const keychain = createKeychainSecretStore();
  if (process.platform === "win32") {
    return win32Platform(options, { stateFolder, keychain });
  }
  if (process.platform === "darwin" || process.platform === "linux") {
    const permissions = createPosixFilePermissions();
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
      ...posixShell(options, stateFolder),
      findBrowser: () => firstProgram(posixBrowserPrograms(options)),
      screenCapture: posixScreenCapture(options),
    };
  }
  throw new BinferenceError({
    code: "platform.unsupported_os",
    message: `binference runs on macOS, Linux and Windows, not ${process.platform}.`,
    details: { os: process.platform },
  });
}
