import type { Socket } from "node:net";
import type { Result, Secret } from "@binference/core";
import type { IpcBindOptions, IpcBinding } from "./ipc/ipc-binding.js";

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
 * Named secrets at rest. The OS keychain holds them where one answers: Keychain on macOS,
 * Credential Manager on Windows, the Secret Service on Linux, every entry under the service
 * `binference`, so the name `telegram-bot` is the entry `binference/telegram-bot`. Where none
 * answers, files sealed with the owner's passphrase hold them.
 *
 * A name is 1 to 64 lowercase letters, digits, dots, dashes and underscores, starting with a letter
 * or a digit; any other name throws `platform.secret_name_invalid` before the store is touched.
 * A store that cannot answer throws a `BinferenceError`, such as `platform.keychain_failed`.
 */
export interface SecretStore {
  /** Reads one entry. Returns `not_found` when the store holds no entry of that name. */
  read(name: string, signal: AbortSignal): Promise<Result<Secret, "not_found">>;
  /** Stores a value under the name, replacing the value it held. */
  write(name: string, value: Secret, signal: AbortSignal): Promise<void>;
  /** Removes one entry. Returns `not_found` when the store holds no entry of that name. */
  delete(name: string, signal: AbortSignal): Promise<Result<void, "not_found">>;
}
