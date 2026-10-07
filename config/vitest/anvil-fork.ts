import { type ChildProcessByStdio, spawn } from "node:child_process";
import { once } from "node:events";
import { createInterface } from "node:readline";
import type { Readable } from "node:stream";
import { text } from "node:stream/consumers";

/** Where anvil forks from: a public node and a block it still holds the state of. */
export interface ForkSource {
  readonly upstream: string;
  readonly block: bigint;
}

/** An anvil process serving a fork on 127.0.0.1. */
export interface AnvilFork {
  /** anvil's JSON-RPC endpoint. */
  readonly url: string;
  /** The block the fork was taken at. */
  readonly block: bigint;
  /** Stops anvil and waits until it exits. */
  stop(): Promise<void>;
}

type AnvilProcess = ChildProcessByStdio<null, Readable, Readable>;

// anvil prints its address once the fork is ready; with --port 0 the system picks a free port.
// Every other line, the default accounts' keys among them, is read and dropped.
const listening = /^Listening on (127\.0\.0\.1:\d+)$/;
const versionLine = /^anvil Version: (\S+)/m;
const readyTimeoutMs = 60_000;
const stopTimeoutMs = 10_000;
const versionTimeoutMs = 10_000;
// anvil writes errors alone to stderr; the end of it explains a failed start.
const errorTailLength = 4_000;

function anvilArgs(source: ForkSource): readonly string[] {
  return [
    ["--fork-url", source.upstream],
    ["--fork-block-number", source.block.toString()],
    ["--host", "127.0.0.1"],
    ["--port", "0"],
    // Every read goes to the public node; a disk cache keyed by block would only grow.
    ["--no-storage-caching"],
    // Blocks are mined on demand, so a test decides which transactions share one.
    ["--no-mining"],
  ].flat();
}

function waitForAddress(child: AnvilProcess): Promise<string> {
  let errors = "";
  child.stderr.on("data", (chunk: Buffer) => {
    errors = `${errors}${chunk.toString("utf8")}`.slice(-errorTailLength);
  });
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`anvil did not listen within ${String(readyTimeoutMs)} ms.`));
    }, readyTimeoutMs);
    const fail = (error: Readonly<Error>): void => {
      clearTimeout(timer);
      reject(error);
    };
    createInterface({ input: child.stdout }).on("line", (line) => {
      const address = listening.exec(line)?.[1];
      if (address !== undefined) {
        clearTimeout(timer);
        resolve(address);
      }
    });
    child.once("error", fail);
    child.once("exit", (code) => {
      fail(new Error(`anvil exited (${String(code)}) before it listened: ${errors.trim()}`));
    });
  });
}

async function stopProcess(child: AnvilProcess): Promise<void> {
  // A program that never started has no pid and sends no exit event.
  if (child.pid === undefined || child.exitCode !== null || child.signalCode !== null) {
    return;
  }
  const exited = once(child, "exit");
  child.kill();
  const timer = setTimeout(() => child.kill("SIGKILL"), stopTimeoutMs);
  await exited;
  clearTimeout(timer);
}

/**
 * Reads the version of the anvil on PATH, such as `1.7.1`. It rejects at once when there is none,
 * so a missing Foundry install never waits out the start retries.
 */
export async function readAnvilVersion(): Promise<string> {
  const child = spawn("anvil", ["--version"], {
    stdio: ["ignore", "pipe", "ignore"],
    timeout: versionTimeoutMs,
  });
  const output = text(child.stdout);
  try {
    await once(child, "exit");
  } catch (error) {
    throw new Error("anvil is not on PATH. Install Foundry (https://getfoundry.sh).", {
      cause: error,
    });
  }
  return versionLine.exec(await output)?.[1] ?? "of an unknown version";
}

/**
 * Starts anvil forked from `source` and resolves once it listens on 127.0.0.1. A start that fails
 * stops the process and rejects with anvil's own error.
 */
export async function startAnvilFork(source: ForkSource): Promise<AnvilFork> {
  const child = spawn("anvil", anvilArgs(source), { stdio: ["ignore", "pipe", "pipe"] });
  try {
    const address = await waitForAddress(child);
    return { url: `http://${address}`, block: source.block, stop: async () => stopProcess(child) };
  } catch (error) {
    await stopProcess(child);
    throw error;
  }
}
