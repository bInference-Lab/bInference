import type { EventEmitter } from "node:events";
import { createServer } from "node:net";
import { join } from "node:path";
import type { ProtocolClient } from "@binference/client";
import type { Clock } from "@binference/core";
import { createSeededRandom } from "@binference/core/testing";
import {
  acquireFileLock,
  ensurePrivateFolder,
  readLogLines,
  writePrivateFile,
} from "@binference/platform";
import { connectEngine } from "../commands/connect-engine.js";
import type { CliHost } from "../program/cli-host.js";

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
// The test folder is the test's own; its permissions do not matter here.
const noPermissions = {
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

/** A host for one `binference` command line on a test machine. */
export function hostOn(
  machine: TestMachine,
  argv: readonly string[],
  env: Readonly<Record<string, string>> = {},
): TestHost {
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
  const text = `{\n  version: 2,\n  telegram: { botToken: { fromEnv: "TEST_BOT_TOKEN" } },\n${extra}}\n`;
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
