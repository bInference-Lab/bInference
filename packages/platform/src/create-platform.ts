import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";
import { BinferenceError, type Clock } from "@binference/core";
import { createKeychainSecretStore } from "./keychain/keychain-secret-store.js";
import type { FilePermissions, IpcEndpoint, SecretStore, ServiceManager } from "./ports.js";
import { createLaunchdServiceManager } from "./posix/launchd-service-manager.js";
import { createPosixFilePermissions } from "./posix/posix-file-permissions.js";
import { createPosixIpcEndpoint } from "./posix/posix-ipc-endpoint.js";
import { createSystemdServiceManager } from "./posix/systemd-service-manager.js";
import { resolveStateFolder, type StateFolder, type StateFolderOptions } from "./state-folder.js";
import { createSchtasksServiceManager } from "./win32/schtasks-service-manager.js";
import { createWin32FilePermissions } from "./win32/win32-file-permissions.js";
import { createWin32IpcEndpoint } from "./win32/win32-ipc-endpoint.js";

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
}

/** This OS's adapters, chosen once at startup. */
export interface Platform {
  readonly stateFolder: StateFolder;
  readonly permissions: FilePermissions;
  /** `SIGINT` and `SIGTERM` on macOS and Linux; `SIGINT` and `SIGBREAK` on Windows. */
  readonly stopSignals: readonly NodeJS.Signals[];
  readonly ipcEndpoint: (options: IpcEndpointOptions) => IpcEndpoint;
  /** The OS keychain, entries under the service `binference`. */
  readonly keychain: SecretStore;
  /** This OS's service manager; the clock times its waits for a service to start or stop. */
  readonly serviceManager: (clock: Clock) => ServiceManager;
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

/**
 * Picks the adapters for the OS this process runs on. Throws `platform.unsupported_os` on any OS
 * but macOS, Linux and Windows.
 */
export function createPlatform(options: PlatformOptions = {}): Platform {
  const stateFolder = resolveStateFolder(options);
  const keychain = createKeychainSecretStore();
  if (process.platform === "win32") {
    return {
      stateFolder,
      permissions: createWin32FilePermissions(),
      stopSignals: ["SIGINT", "SIGBREAK"],
      ipcEndpoint: (endpoint) => createWin32IpcEndpoint(endpoint),
      keychain,
      serviceManager: (clock) => createSchtasksServiceManager({ clock }),
    };
  }
  if (process.platform === "darwin" || process.platform === "linux") {
    const permissions = createPosixFilePermissions();
    return {
      stateFolder,
      permissions,
      stopSignals: ["SIGINT", "SIGTERM"],
      ipcEndpoint: ({ name }) =>
        createPosixIpcEndpoint({ runFolder: stateFolder.run, name, permissions }),
      keychain,
      serviceManager: posixServiceManager(options, permissions),
    };
  }
  throw new BinferenceError({
    code: "platform.unsupported_os",
    message: `binference runs on macOS, Linux and Windows, not ${process.platform}.`,
    details: { os: process.platform },
  });
}
