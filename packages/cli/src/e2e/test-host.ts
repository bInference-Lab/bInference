import { EventEmitter } from "node:events";
import { createServer } from "node:net";
import { join } from "node:path";
import type { ProtocolClient } from "@binference/client";
import { BinferenceError, type Clock, type Http } from "@binference/core";
import { createManualClock, createSeededRandom } from "@binference/core/testing";
import {
  acquireFileLock,
  ensurePrivateFolder,
  type FilePermissions,
  readLogLines,
  writePrivateFile,
} from "@binference/platform";
import { createTempFolder, type TempFolder } from "@binference/platform/testing";
import { connectEngine } from "../commands/connect-engine.js";
import { currentConfigVersion } from "../config/migrations/config-migrations.js";
import type { CliHost } from "../program/cli-host.js";
import { runCli } from "../program/run-cli.js";

/** A host whose output a test reads, with lines it can wait for. */
export interface TestHost extends CliHost {
  readonly stdout: () => string;
  readonly stderr: () => string;
  /** Resolves with the first whole line on standard output that `match` accepts. */
  readonly waitForLine: (match: (line: string) => boolean) => Promise<string>;
}

/** What one state folder's commands share: the folder, the clock and the stop signals. */
export interface TestMachine {
  readonly folder: string;
  readonly clock: Clock;
  readonly signals: EventEmitter;
}

// Store workers run the TypeScript source, as in the store's own tests.
const workerExecArgv = ["--conditions=@binference/source", "--import", "tsx"];
// Each host draws its own random bytes.
const seeds = { next: 17 };
/** Permissions that change nothing: a test's folder is its own, so its permissions do not matter. */
export const noPermissions: FilePermissions = {
  restrictFolder: async () => Promise.resolve(),
  restrictFile: async () => Promise.resolve(),
};

interface Waiter {
  readonly match: (line: string) => boolean;
  readonly resolve: (line: string) => void;
}

function lineWatcher() {
  const lines: string[] = [];
  const waiters = new Set<Waiter>();
  const check = (line: string): void => {
    waiters.forEach((waiter) => {
      if (waiter.match(line)) {
        waiters.delete(waiter);
        waiter.resolve(line);
      }
    });
  };
  return {
    write: (text: string) => {
      const added = text.split("\n").filter((line) => line !== "");
      lines.push(...added);
      added.forEach(check);
    },
    waitFor: async (match: (line: string) => boolean) => {
      const found = lines.find(match);
      return found ?? new Promise<string>((resolve) => waiters.add({ match, resolve }));
    },
  };
}

// No test reaches the network: every outside service a test needs answers through its own fake.
const offline: Http = {
  request: async () =>
    Promise.reject(
      new BinferenceError({
        code: "http.unreachable",
        message: "Tests reach no outside service.",
        retryable: true,
      }),
    ),
};

/** What a test gives a host in place of the outside world and the person at the terminal. */
export type HostParts = Partial<Pick<CliHost, "http" | "prompter" | "botApiFetch">>;

/** A host for one `binference` command line on a test machine. */
export function hostOn(
  machine: TestMachine,
  argv: readonly string[],
  env: Readonly<Record<string, string>> = {},
): TestHost {
  return hostWith(machine, argv, { env });
}

/** A host for one command line, with its variables and what replaces the outside world. */
export function hostWith(
  machine: TestMachine,
  argv: readonly string[],
  options: { readonly env: Readonly<Record<string, string>>; readonly parts?: HostParts },
): TestHost {
  const { env, parts = {} } = options;
  const out = lineWatcher();
  const written = { out: "", err: "" };
  return {
    argv,
    env: { BINFERENCE_HOME: machine.folder, LANG: "en_US.UTF-8", ...env },
    out: (text) => {
      written.out += text;
      out.write(text);
    },
    err: (text) => {
      written.err += text;
    },
    clock: machine.clock,
    random: createSeededRandom((seeds.next += 1)),
    http: offline,
    ...parts,
    signals: machine.signals,
    version: "2026.10.0-test",
    workerExecArgv,
    stdout: () => written.out,
    stderr: () => written.err,
    waitForLine: out.waitFor,
  };
}

/** Writes a config.json5 that loads: the current version, and the bot token as a secret source. */
export async function writeTestConfig(folder: string, extra = ""): Promise<void> {
  const files = { permissions: noPermissions, signal: new AbortController().signal };
  await ensurePrivateFolder(folder, files);
  const version = String(currentConfigVersion);
  const bot = `telegram: { botToken: { fromEnv: "TEST_BOT_TOKEN" } }`;
  const text = `{\n  version: ${version},\n  ${bot},\n${extra}}\n`;
  await writePrivateFile(join(folder, "config.json5"), text, files);
}

/** A loopback port nothing listens on right now. */
export async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  await new Promise<void>((resolve) => {
    server.close(() => resolve());
  });
  return typeof address === "object" && address !== null ? address.port : 0;
}

/** Whether nothing holds the folder's engine lock: takes the lock and frees it at once. */
export function isUnlocked(folder: string): boolean {
  const lock = acquireFileLock(join(folder, "engine.lock"));
  if (lock.ok) {
    lock.value.release();
  }
  return lock.ok;
}

/** A CLI client signed in to the machine's engine; throws when it cannot connect. */
export async function connectClient(machine: TestMachine): Promise<ProtocolClient> {
  const connection = await connectEngine(hostOn(machine, []), new AbortController().signal);
  if (!connection.ok) {
    throw new Error(`The test client could not connect: ${connection.reason}.`);
  }
  return connection.client;
}

/** Every line of the machine's engine log, or none before the file exists. */
export async function engineLogLines(machine: TestMachine): Promise<readonly string[]> {
  const read = await readLogLines(join(machine.folder, "logs", "engine.log"), {
    maxBytes: 1_000_000,
    signal: new AbortController().signal,
  });
  return read.ok ? read.value.lines : [];
}

/** What one command line did: its exit code and its output. */
export interface CommandOutcome {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

/** Runs one `binference` command line on the machine to its end. */
export async function runOn(
  machine: TestMachine,
  argv: readonly string[],
  env: Readonly<Record<string, string>> = {},
): Promise<CommandOutcome> {
  const host = hostOn(machine, argv, env);
  const code = await runCli(host);
  return { code, stdout: host.stdout(), stderr: host.stderr() };
}

/** Machines a test file makes, each in a fresh temporary folder, and removes after each test. */
export interface TestMachines {
  /** A machine with an empty state folder and a manual clock at `nowMs`. */
  create(nowMs: number): Promise<TestMachine>;
  /** Removes every folder made since the last call. */
  removeAll(): Promise<void>;
}

/** Makes the machines of one test file. */
export function createTestMachines(): TestMachines {
  const folders: TempFolder[] = [];
  return {
    async create(nowMs) {
      const folder = await createTempFolder("bnf-");
      folders.push(folder);
      return { folder: folder.path, clock: createManualClock(nowMs), signals: new EventEmitter() };
    },
    async removeAll() {
      await Promise.all(folders.splice(0).map(async (folder) => folder.remove()));
    },
  };
}
