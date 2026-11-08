import type { Socket } from "node:net";
import type { Result } from "@binference/core";
import type { CommandLaunch } from "./command-launch.js";
import type { IpcBindOptions, IpcBinding } from "./ipc/ipc-binding.js";
import type { ScreenRefusal, ScreenShot } from "./screen-shot.js";
import type { ServiceDefinition, ServiceStatus } from "./service/service-definition.js";
import type { RunningShell, ShellLaunch } from "./shell-launch.js";

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
  /**
   * Makes the entries of an existing folder durable, such as a file renamed into it, so a crash
   * cannot undo the rename: an fsync of the folder on macOS and Linux. Windows offers no fsync of
   * a folder, so there it only checks the signal.
   */
  syncFolder(path: string, signal: AbortSignal): Promise<void>;
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
  /**
   * Stops the service now and keeps it, so the OS starts it again at the owner's next login, or at
   * the next `install`. On macOS and Linux the program gets `SIGTERM` and the definition's stop
   * timeout to exit; Windows ends the task's program without a signal it can hear, so a caller
   * that needs a clean exit asks the program to stop first. Returns `not_installed` when there is
   * no such service.
   */
  stop(name: string, signal: AbortSignal): Promise<Result<void, "not_installed">>;
  /** Stops the service and removes it. Returns `not_installed` when there is no such service. */
  uninstall(name: string, signal: AbortSignal): Promise<Result<void, "not_installed">>;
  /** Whether the service is installed, running, and set to start at login. */
  status(name: string, signal: AbortSignal): Promise<ServiceStatus>;
}

/**
 * Whether this machine can keep a command away from binference's own secrets: `held` when it can,
 * `none` with a reason when it has no mechanism to (decision 0378). A machine that answers `none`
 * never runs a command, so the reason names why and the next step.
 */
export type CommandWallState =
  | { readonly kind: "held" }
  | { readonly kind: "none"; readonly reason: string };

/**
 * Keeps every command the agent runs away from the parts of the state folder that would let it act
 * as the owner or the engine (`auth/`, `keys/`, the databases, the config and `run/`) and away
 * from binference's keychain entries, while leaving the rest of the machine reachable
 * ([decision 0378](../../../docs/DECISIONS.md)). It is the narrowest confinement each OS offers:
 * a sandbox profile that denies those paths alone, not a general sandbox.
 */
export interface CommandWall {
  readonly state: CommandWallState;
  /**
   * Wraps a launch so the walled paths are unreachable to the command and everything it starts.
   * Throws `platform.no_wall` when {@link state} is `none`.
   */
  wrap(launch: CommandLaunch): CommandLaunch;
}

/**
 * Runs the agent's commands in the machine's shell behind the {@link CommandWall} (decision 0378):
 * the owner's login shell on macOS and Linux, PowerShell on Windows. A stop or a time limit ends a
 * command with every process it started.
 */
export interface ShellLauncher {
  /** Whether the wall holds here; a launcher whose wall answers `none` starts nothing. */
  readonly wall: CommandWallState;
  /**
   * Starts a command and hands its output, standard output and error together, to `onOutput`.
   * Throws `platform.no_wall` when the wall does not hold.
   */
  start(launch: ShellLaunch, onOutput: (text: string) => void): RunningShell;
}

/**
 * Takes a screenshot of the owner's screen with the OS's own program (decision 0406): every
 * display, or one by its number from 1. It only looks: nothing here moves the mouse, presses a
 * key or touches a window. Each program runs with an argument array, never a shell, under a time
 * limit, in a folder of its own that is removed after it. It rejects with the signal's reason once
 * the signal aborts.
 */
export interface ScreenCapture {
  /** The program the owner allows to record the screen, which a `no_permission` refusal means. */
  readonly program: string;
  capture(
    request: { readonly display?: number },
    call: { readonly signal: AbortSignal },
  ): Promise<Result<readonly ScreenShot[], ScreenRefusal>>;
}
