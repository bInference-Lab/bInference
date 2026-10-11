import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { type NodeProgram, writePrivateFile } from "@binference/platform";
import { createTempFolder, type TempFolder } from "@binference/platform/testing";
import { protocolIdSchema } from "@binference/protocol";
import { readControlLines } from "@binference/runtime";
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { builtRuntime, type StartRuntime } from "../agent-runtime/start-runtime.js";
import { type InitMachine, runOn } from "./init-fixtures.js";
import { connectClient, hostOn, noPermissions, type TestMachine } from "./test-host.js";
import { createRunningEngines } from "./unlock-fixtures.js";

// These tests run the runtime binference ships, from its TypeScript source, as a process of its
// own: only a real process shows what it inherits, how fast it comes back and how it stops.
const slow = { timeout: 60_000 };
const engines = createRunningEngines();
const folders: TempFolder[] = [];
const signal = (): AbortSignal => new AbortController().signal;

afterEach(async () => {
  await engines.stopAll();
  await Promise.all(folders.splice(0).map(async (folder) => folder.remove()));
});

const probeSchema = z.object({ env: z.array(z.string()) });

// An engine's environment full of what a runtime must never see.
const noisyEnv = {
  PATH: process.env["PATH"] ?? "bin",
  LANG: "en_US.UTF-8",
  OPENAI_API_KEY: "sk-must-not-leak",
  BINFERENCE_HOME: "state-folder",
};

interface Watched extends NodeProgram {
  /** Settles once the engine has read the runtime's `ready` line. */
  readonly ready: Promise<void>;
}

function watched(program: NodeProgram): Watched {
  const seen = { ready: (): void => undefined };
  const ready = new Promise<void>((resolve) => {
    seen.ready = resolve;
  });
  async function* output(): AsyncGenerator<Uint8Array> {
    for await (const chunk of program.output) {
      yield chunk;
      if (Buffer.from(chunk).toString("utf8").includes('"t":"ready"')) {
        seen.ready();
      }
    }
  }
  return { ...program, output: output(), ready };
}

// The real runtime for an engine on the machine: each start waits for `hold`, then is watched.
// `requested(n)` settles once the engine asked for start `n`, with that start's process.
function realRuntimes(machine: TestMachine) {
  const start = builtRuntime({
    env: noisyEnv,
    workerExecArgv: hostOn(machine, []).workerExecArgv ?? [],
  });
  // Each start is held in an object: resolving a promise with a promise would wait for it.
  const starts: { readonly program: Promise<Watched> }[] = [];
  const waiting: ((started: { readonly program: Promise<Watched> }) => void)[] = [];
  const hold = { gate: Promise.resolve() };
  const startRuntime: StartRuntime = async (stop) => {
    const gate = hold.gate;
    const program = (async () => {
      await gate;
      return watched(await start(stop));
    })();
    starts.push({ program });
    waiting.splice(0).forEach((resolve) => resolve({ program }));
    return program;
  };
  const requested = async (n: number): Promise<{ readonly program: Promise<Watched> }> =>
    starts[n] ?? new Promise((resolve) => waiting.push(resolve));
  const nth = async (n: number): Promise<Watched> => (await requested(n)).program;
  return { startRuntime, requested, nth, hold, started: () => starts.length };
}

async function runtimeLine(machine: InitMachine): Promise<string> {
  const status = await runOn(machine, ["status"]);
  return status.stdout.split("\n").find((line) => line.includes("Agent runtime")) ?? status.stdout;
}

describe("the agent runtime as a process of its own", () => {
  it("comes back within 5 seconds of a kill", slow, async () => {
    const machine = await engines.setUp();
    const runtimes = realRuntimes(machine);
    await engines.start(machine, { parts: { startRuntime: runtimes.startRuntime } });
    const first = await runtimes.nth(0);
    await first.ready;
    await expect(runtimeLine(machine)).resolves.toContain("Agent runtime: ok");
    const killedAt = performance.now();
    first.kill();
    await (
      await runtimes.nth(1)
    ).ready;
    expect(performance.now() - killedAt).toBeLessThan(5_000);
    await expect(runtimeLine(machine)).resolves.toContain("Agent runtime: ok");
  });

  it(
    "shows the gap in status and fails routed calls as unavailable while it is down",
    slow,
    async () => {
      const machine = await engines.setUp();
      const runtimes = realRuntimes(machine);
      await engines.start(machine, { parts: { startRuntime: runtimes.startRuntime } });
      await (
        await runtimes.nth(0)
      ).ready;
      const client = await connectClient(machine);
      const release = { open: (): void => undefined };
      try {
        const args = {
          agent: protocolIdSchema("agent").parse("agt_0190f1c2-3a4b-7c5d-8e6f-000000000001"),
        };
        // The runtime answers: it serves no routed operation yet.
        await expect(client.call("notes/list", args, { signal: signal() })).rejects.toMatchObject({
          code: "protocol.unknown_op",
        });
        runtimes.hold.gate = new Promise((resolve) => {
          release.open = resolve;
        });
        (await runtimes.nth(0)).kill();
        const second = await runtimes.requested(1);
        await expect(runtimeLine(machine)).resolves.toMatch(/Agent runtime: failing since /);
        await expect(client.call("notes/list", args, { signal: signal() })).rejects.toMatchObject({
          code: "runtime.unavailable",
        });
        release.open();
        await (
          await second.program
        ).ready;
        await expect(runtimeLine(machine)).resolves.toContain("Agent runtime: ok");
      } finally {
        release.open();
        client.close();
      }
    },
  );

  it("stops first and cleanly when the engine stops, within its 30 seconds", slow, async () => {
    const machine = await engines.setUp();
    const runtimes = realRuntimes(machine);
    await engines.start(machine, { parts: { startRuntime: runtimes.startRuntime } });
    const runtime = await runtimes.nth(0);
    await runtime.ready;
    const stoppedAt = performance.now();
    await engines.stopAll();
    await expect(runtime.exited).resolves.toBe(0);
    expect(performance.now() - stoppedAt).toBeLessThan(30_000);
    expect(runtimes.started()).toBe(1);
  });

  it("sees no variable of the engine's environment", slow, async () => {
    const folder = await createTempFolder("bnf-rt-");
    folders.push(folder);
    const probe = join(folder.path, "probe.mjs");
    // Runs in the runtime's process before any of its code, and writes what it inherited.
    await writePrivateFile(
      probe,
      "process.stdout.write(JSON.stringify({ env: Object.keys(process.env) }) + '\\n');\n",
      { permissions: noPermissions, signal: signal() },
    );
    const loader = ["--conditions=@binference/source", "--import", "tsx"];
    const start = builtRuntime({ env: noisyEnv, workerExecArgv: ["--import", probe, ...loader] });
    const stop = new AbortController();
    const program = await start(stop.signal);
    try {
      const lines = readControlLines(program.output)[Symbol.asyncIterator]();
      const first = await lines.next();
      const seen = probeSchema.parse(JSON.parse(String(first.value)));
      // Each OS adds its own: Windows needs SystemRoot, and macOS gives every process its text
      // encoding.
      const fromTheOs = new Set(["SystemRoot", "__CF_USER_TEXT_ENCODING"]);
      expect(seen.env.filter((name) => !fromTheOs.has(name))).toStrictEqual([]);
    } finally {
      stop.abort();
      await program.exited;
    }
  });
});
