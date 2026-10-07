import type { HttpRequest, HttpResponse } from "./http-exchange.js";
import type { LogFields } from "./log-record.js";
import type { Result } from "./result.js";
import type { Secret } from "./secret/secret.js";

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
