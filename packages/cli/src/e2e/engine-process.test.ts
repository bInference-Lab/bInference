import { EventEmitter } from "node:events";
import { fileURLToPath } from "node:url";
import type { ProtocolClient } from "@binference/client";
import { createManualClock } from "@binference/core/testing";
import type { NodeProgram } from "@binference/platform";
import { createTempFolder, type TempFolder } from "@binference/platform/testing";
import { afterEach, describe, expect, it } from "vitest";
import { type SourceProgram, startSourceProgram } from "./source-program.js";
import {
  connectClient,
  freePort,
  isUnlocked,
  type TestMachine,
  writeTestConfig,
} from "./test-host.js";

// These tests run `binference start` as processes of their own, as an owner's machine does: the
// engine lock is the OS's, so only separate processes prove it.
const main = fileURLToPath(new URL("../main.ts", import.meta.url));
const slow = { timeout: 60_000 };
const folders: TempFolder[] = [];
const programs: NodeProgram[] = [];
// The shutdown's whole budget; a stop that takes longer fails the test.
const shutdownBudgetMs = 30_000;

afterEach(async () => {
  programs.splice(0).forEach((program) => program.kill());
  await Promise.all(folders.splice(0).map(async (folder) => folder.remove()));
});

async function newMachine(): Promise<TestMachine> {
  const folder = await createTempFolder("bnf-proc-");
  folders.push(folder);
  await writeTestConfig(folder.path);
  return { folder: folder.path, clock: createManualClock(0), signals: new EventEmitter() };
}

function runBinference(machine: TestMachine, argv: readonly string[]): SourceProgram {
  const started = startSourceProgram({
    file: main,
    args: argv,
    parentEnv: process.env,
    env: { BINFERENCE_HOME: machine.folder, LANG: "en_US.UTF-8" },
    signal: AbortSignal.timeout(slow.timeout),
  });
  programs.push(started.program);
  return started;
}

async function startEngine(machine: TestMachine): Promise<SourceProgram> {
  const port = String(await freePort());
  const engine = runBinference(machine, ["start", "--json", "--set", `engine.port=${port}`]);
  await expect(engine.lineWith('"state":"ready"')).resolves.toContain('"ipc"');
  return engine;
}

async function stopOverIpc(machine: TestMachine): Promise<void> {
  const client = await connectClient(machine);
  // The sequence closes the server that answers, so the reply may lose the race to the bye.
  await client.call("engine/stop", {}, { signal: AbortSignal.timeout(10_000) }).catch(() => ({}));
  client.close();
}

describe("binference start as a process of its own", () => {
  it("refuses a second engine on the same state folder while the first runs", slow, async () => {
    const machine = await newMachine();
    const first = await startEngine(machine);
    const port = String(await freePort());
    const second = runBinference(machine, ["start", "--json", "--set", `engine.port=${port}`]);
    await expect(second.program.exited).resolves.toBe(1);
    await expect(second.lineWith("error")).resolves.toBe(
      '{"error":{"code":"engine.already_running"}}',
    );
    const budget = AbortSignal.timeout(shutdownBudgetMs);
    await stopOverIpc(machine);
    await expect(first.program.exited).resolves.toBe(0);
    expect(budget.aborted).toBe(false);
    await expect(first.lineWith('"state":"stopped"')).resolves.toBe(
      '{"state":"stopped","unfinished":[]}',
    );
    expect(isUnlocked(machine.folder)).toBe(true);
  });

  it("lets the next engine take the folder once a killed one is gone", slow, async () => {
    const machine = await newMachine();
    const killed = await startEngine(machine);
    killed.program.kill();
    await expect(killed.program.exited).resolves.toBeUndefined();
    await startEngine(machine);
    await stopOverIpc(machine);
  });
});

// Resolves with the first push on the topic whose data holds `text`, once the subscription has
// loaded; rejects after 15 seconds.
async function pushWith(
  client: ProtocolClient,
  topic: "config" | "notice",
  text: string,
): Promise<{ readonly heard: Promise<string> }> {
  const loaded = { done: (): void => undefined };
  const isLoaded = new Promise<void>((resolve) => {
    loaded.done = resolve;
  });
  const heard = new Promise<string>((resolve, reject) => {
    AbortSignal.timeout(15_000).addEventListener("abort", () => reject(new Error(`No ${text}.`)));
    client.subscribe(topic, {
      onPush: (push) => {
        const data = JSON.stringify(push.data);
        if (data.includes(text)) {
          resolve(data);
        }
      },
      refetch: async () => {
        loaded.done();
        return Promise.resolve();
      },
    });
  });
  await isLoaded;
  return { heard };
}

describe("the settings of a running engine", () => {
  it("reload when the config file changes, journaled and announced", slow, async () => {
    const machine = await newMachine();
    await startEngine(machine);
    const client = await connectClient(machine);
    try {
      const changed = await pushWith(client, "config", "logging.level");
      const told = await pushWith(client, "notice", "notice.configChanged");
      await writeTestConfig(machine.folder, '  logging: { level: "debug" },\n');
      await expect(changed.heard).resolves.toContain('"by":"engine","surface":"config.json5"');
      await expect(told.heard).resolves.toContain('"afterRestart":"none"');
      const history = await client.call(
        "config/history",
        {},
        { signal: AbortSignal.timeout(10_000) },
      );
      expect(history.items.map((item) => [item.path, item.before, item.after])).toStrictEqual([
        ["logging.level", "info", "debug"],
      ]);
    } finally {
      client.close();
    }
    await stopOverIpc(machine);
  });

  it(
    "keep running on the old settings when the file has a problem, and say which",
    slow,
    async () => {
      const machine = await newMachine();
      await startEngine(machine);
      const client = await connectClient(machine);
      try {
        const told = await pushWith(client, "notice", "notice.configInvalid");
        await writeTestConfig(machine.folder, '  logging: { level: "loud" },\n');
        await expect(told.heard).resolves.toContain('"problem":"bad_value","key":"logging.level"');
        const history = await client.call(
          "config/history",
          {},
          { signal: AbortSignal.timeout(10_000) },
        );
        expect(history.items).toStrictEqual([]);
      } finally {
        client.close();
      }
      await stopOverIpc(machine);
    },
  );
});
