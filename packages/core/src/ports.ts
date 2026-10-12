import type { HttpRequest, HttpResponse } from "./http-exchange.js";
import type { LogFields } from "./log-record.js";
import type { Result } from "./result.js";
import type { Secret } from "./secret/secret.js";
import type { WorkspacePlace, WorkspaceText } from "./workspace/workspace-place.js";

/** Reads the time and waits. Pure packages read time only through this port. */
export interface Clock {
  /** Epoch milliseconds in UTC. */
  now(): number;
  /** Resolves after `delayMs`, or rejects with the signal's reason as soon as it aborts. */
  sleep(delayMs: number, signal: AbortSignal): Promise<void>;
}

/** Gives random bytes. Pure packages read randomness only through this port. */
export interface Random {
  /** `length` new random bytes. */
  bytes(length: number): Uint8Array;
}

/**
 * Writes log records for one subsystem. Records carry ids, never prompts, chat text or secrets, and
 * a logger never throws: a failing log never blocks the money path.
 */
export interface Logger {
  debug(event: string, fields?: LogFields): void;
  info(event: string, fields?: LogFields): void;
  warn(event: string, fields?: LogFields): void;
  error(event: string, fields?: LogFields): void;
  /** A logger for a part of this subsystem: `engine` and `policy` give `engine.policy`. */
  child(subsystem: string): Logger;
}

/**
 * Sends outbound HTTP requests. Every request carries a signal; a status of 400 or more is an
 * answer, not a fault. A request that never gets an answer rejects with a `BinferenceError`.
 */
export interface Http {
  request(request: HttpRequest): Promise<HttpResponse>;
}

/**
 * Named secrets at rest, such as the agent key and the bot token. The composition root picks the
 * adapter: the OS keychain or the passphrase store of `@binference/platform`, or a hosted secret
 * service.
 *
 * A name is 1 to 64 lowercase letters, digits, dots, dashes and underscores, starting with a letter
 * or a digit; any other name throws `platform.secret_name_invalid` before the store is touched
 * (`checkSecretName`). A store that cannot answer throws a `BinferenceError`, such as
 * `platform.keychain_failed`.
 */
export interface SecretStore {
  /** Reads one entry. Returns `not_found` when the store holds no entry of that name. */
  read(name: string, signal: AbortSignal): Promise<Result<Secret, "not_found">>;
  /** Stores a value under the name, replacing the value it held. */
  write(name: string, value: Secret, signal: AbortSignal): Promise<void>;
  /** Removes one entry. Returns `not_found` when the store holds no entry of that name. */
  delete(name: string, signal: AbortSignal): Promise<Result<void, "not_found">>;
}

/**
 * Each agent's workspace files, such as `RULES.md`, one folder per agent: the files the agent's
 * context starts with. The composition root picks the adapter: a folder in the state folder, from
 * `@binference/platform`, or a hosted store.
 *
 * A place names an agent by its id and a file by its name (`checkWorkspacePlace`); any other throws
 * `platform.workspace_name_invalid` before the store is touched. A store that cannot answer throws
 * a `BinferenceError`. A write is all or nothing: a reader sees the old text or the new one.
 */
export interface WorkspaceFiles {
  /** Reads one file. Returns `not_found` when the agent has no such file. */
  read(place: WorkspacePlace, signal: AbortSignal): Promise<Result<WorkspaceText, "not_found">>;
  /** Writes one file, replacing its text, and answers when it changed. */
  write(place: WorkspacePlace, text: string, signal: AbortSignal): Promise<number>;
  /**
   * Writes one file only when the agent has none of that name, and answers when it was made.
   * Returns `exists` and changes nothing when the file is there.
   */
  create(
    place: WorkspacePlace,
    text: string,
    signal: AbortSignal,
  ): Promise<Result<number, "exists">>;
}
