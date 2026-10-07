import type { Socket } from "node:net";
import type { Result } from "@binference/core";
import type { IpcBindOptions, IpcBinding } from "./ipc/ipc-binding.js";
import type { ServiceDefinition, ServiceStatus } from "./service/service-definition.js";

/**
 * Makes a file or folder readable and writable by its owner only: POSIX modes `0600` and `0700` on
 * macOS and Linux, an access list that names the owner alone on Windows.
 */
export interface FilePermissions {
  /**
   * Restricts an existing folder to its owner. On Windows the files created in it later inherit
   * that access list, so restrict a folder before writing secrets into it.
   */
  restrictFolder(path: string, signal: AbortSignal): Promise<void>;
  /** Restricts an existing file to its owner. */
  restrictFile(path: string, signal: AbortSignal): Promise<void>;
}

/**
 * Who can reach a path: `owner_only` when only its owner can, `open` when other accounts can,
 * `missing` when nothing is there, and `unknown` where this OS's access lists are not read.
 */
export type FileAccessState = "owner_only" | "open" | "missing" | "unknown";

/**
 * Reads who can reach a file or folder, as `binference check` reports it. On macOS and Linux the
 * group and other bits of its mode decide (`077`); on Windows it answers `unknown` for a path that
 * exists, since reading an access list by security id needs PowerShell, which takes seconds. A
 * path it cannot read throws `platform.access_unreadable`.
 */
export interface FileAccess {
  read(path: string, signal: AbortSignal): Promise<FileAccessState>;
}

/**
 * One local IPC address: a Unix socket in the state folder's `run` folder, or a named pipe on
 * Windows. Node cannot set a named pipe's access list, and the default one lets other accounts open
 * it, so the address is no security boundary: every connection authenticates through
 * `openIpcChannel` before it carries anything.
 */
export interface IpcEndpoint {
  /** The socket path or the pipe name. */
  readonly address: string;
  /**
   * Listens on the address for this process. Returns `in_use` while another listener holds it, in
   * this process or another; a socket file left by a crashed listener is replaced.
   */
  bind(options: IpcBindOptions): Promise<Result<IpcBinding, "in_use">>;
  /** Connects to the listener. Returns `unreachable` when nobody listens. */
  connect(signal: AbortSignal): Promise<Result<Socket, "unreachable">>;
}

/**
 * Starts a program at the owner's login and restarts it after a crash: a LaunchAgent through
 * `launchctl` on macOS, a `systemctl --user` unit on Linux, a scheduled task through `schtasks` on
 * Windows. The program runs as the owner, in their session, so it reaches their keychain; on
 * Windows the task runs only while the owner is logged on.
 *
 * Each method checks the name or definition first and throws
 * `platform.service_definition_invalid` before anything touches the OS. A service manager that
 * refuses or gives no answer throws `platform.service_failed`.
 */
export interface ServiceManager {
  /**
   * Writes the service, sets it to start at login and starts it, resolving once the OS reports it
   * running. A service of the same name is stopped and replaced.
   */
  install(definition: ServiceDefinition, signal: AbortSignal): Promise<void>;
  /** Stops the service and removes it. Returns `not_installed` when there is no such service. */
  uninstall(name: string, signal: AbortSignal): Promise<Result<void, "not_installed">>;
  /** Whether the service is installed, running, and set to start at login. */
  status(name: string, signal: AbortSignal): Promise<ServiceStatus>;
}
