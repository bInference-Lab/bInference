import { join } from "node:path";
import {
  BinferenceError,
  type Clock,
  createDeadline,
  createSecret,
  type Secret,
} from "@binference/core";
import { readTextFile, type RunProgram, runCommand, type SecretStore } from "@binference/platform";
import type { ReadTextFile } from "../load-config.js";
import type {
  CommandSource,
  EnvSource,
  FileSource,
  KeychainSource,
  SecretSource,
} from "../schema/secret-source.schema.js";

/** How long a `fromCommand` program may run before its secret counts as unavailable. */
const commandTimeoutMs = 10_000;

/** Reads the secret a config key names, when the key's value is needed. */
export interface SecretReader {
  /**
   * Reads the secret behind `source`; `path` is the config key, such as `telegram.botToken`.
   * Throws `config.secret_unavailable` with the next step when the source has no secret; the
   * error never holds the secret or a program's output.
   */
  read(path: string, source: SecretSource, signal: AbortSignal): Promise<Secret>;
}

/** What a {@link SecretReader} reads secrets with. */
export interface SecretReaderOptions {
  /** The engine process's environment, for `fromEnv`. */
  readonly env: Readonly<Record<string, string | undefined>>;
  /** The OS keychain, for `fromKeychain`. */
  readonly keychain: SecretStore;
  /** The account's home folder, which `~/` in a `fromFile` path stands for. */
  readonly homeDir: string;
  /** Times the 10 second limit of `fromCommand`. */
  readonly clock: Clock;
  /** The platform's runner unless a test passes another. */
  readonly run?: RunProgram;
  /** The platform's reader unless a test passes another. */
  readonly readFile?: ReadTextFile;
}

type Reason = "not_set" | "not_found" | "empty" | "failed" | "timeout";

interface Unavailable {
  readonly path: string;
  readonly from: string;
  readonly reason: Reason;
  readonly message: string;
}

function unavailable(problem: Unavailable): BinferenceError {
  return new BinferenceError({
    code: "config.secret_unavailable",
    message: `${problem.path}: ${problem.message}`,
    details: { path: problem.path, from: problem.from, reason: problem.reason },
  });
}

function filled(value: string, problem: Omit<Unavailable, "reason" | "message">): Secret {
  if (value === "") {
    throw unavailable({
      ...problem,
      reason: "empty",
      message: `the secret from ${problem.from} is empty. Put the secret there, or name another secret source.`,
    });
  }
  return createSecret(value);
}

function homePath(path: string, homeDir: string): string {
  return /^~[/\\]/.test(path) ? join(homeDir, path.slice(2)) : path;
}

/** One read: the config key, its source and the caller's signal. */
interface SecretRequest<S extends SecretSource = SecretSource> {
  readonly path: string;
  readonly source: S;
  readonly signal: AbortSignal;
}

async function fromCommand(
  options: SecretReaderOptions,
  { path, source, signal }: SecretRequest<CommandSource>,
): Promise<Secret> {
  const [program = "", ...args] = source.fromCommand;
  const from = `the program ${program}`;
  const deadline = createDeadline({ clock: options.clock, signal, timeoutMs: commandTimeoutMs });
  try {
    const output = await (options.run ?? runCommand)(program, args, deadline.signal);
    return filled(output.trim(), { path, from });
  } catch (error) {
    // The program's own error holds what it printed, which may be the secret: it never leaves.
    signal.throwIfAborted();
    if (error instanceof BinferenceError && error.code === "config.secret_unavailable") {
      throw error;
    }
    const isTimeout = deadline.signal.aborted;
    throw unavailable({
      path,
      from,
      reason: isTimeout ? "timeout" : "failed",
      message: isTimeout
        ? `${program} printed no secret within 10 seconds. Run it yourself to see why.`
        : `${program} failed. Run it yourself to see why.`,
    });
  } finally {
    deadline.clear();
  }
}

function fromEnv(options: SecretReaderOptions, { path, source }: SecretRequest<EnvSource>): Secret {
  const from = `the environment variable ${source.fromEnv}`;
  const value = options.env[source.fromEnv];
  if (value === undefined) {
    const message = `${source.fromEnv} is not set. Set it for the engine, or name another secret source.`;
    throw unavailable({ path, from, reason: "not_set", message });
  }
  return filled(value, { path, from });
}

async function fromKeychain(
  options: SecretReaderOptions,
  { path, source, signal }: SecretRequest<KeychainSource>,
): Promise<Secret> {
  const from = `the keychain entry binference/${source.fromKeychain}`;
  const read = await options.keychain.read(source.fromKeychain, signal);
  if (!read.ok) {
    const message = `${from} does not exist. Add it with binference init, or name another secret source.`;
    throw unavailable({ path, from, reason: "not_found", message });
  }
  return filled(read.value.reveal(), { path, from });
}

async function fromFile(
  options: SecretReaderOptions,
  { path, source, signal }: SecretRequest<FileSource>,
): Promise<Secret> {
  const from = homePath(source.fromFile, options.homeDir);
  const read = await (options.readFile ?? readTextFile)(from, signal);
  if (!read.ok) {
    const message = `${from} does not exist. Write the secret into it, or name another secret source.`;
    throw unavailable({ path, from, reason: "not_found", message });
  }
  return filled(read.value.trim(), { path, from });
}

async function readSource(options: SecretReaderOptions, request: SecretRequest): Promise<Secret> {
  const { source } = request;
  if ("fromEnv" in source) {
    return fromEnv(options, { ...request, source });
  }
  if ("fromKeychain" in source) {
    return fromKeychain(options, { ...request, source });
  }
  if ("fromFile" in source) {
    return fromFile(options, { ...request, source });
  }
  return fromCommand(options, { ...request, source });
}

/**
 * Creates the reader that turns secret sources into secrets: environment variables, the OS
 * keychain, owner-only files and programs such as `op read`, run with an argument array, no
 * shell and a 10 second limit. A file's content and a program's output are trimmed.
 */
export function createSecretReader(options: SecretReaderOptions): SecretReader {
  return {
    read: async (path, source, signal) => {
      signal.throwIfAborted();
      return readSource(options, { path, source, signal });
    },
  };
}
