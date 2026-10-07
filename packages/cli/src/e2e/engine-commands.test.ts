import { EventEmitter } from "node:events";
import { join } from "node:path";
import { jsonValueSchema } from "@binference/core";
import { createManualClock } from "@binference/core/testing";
import { messages } from "@binference/i18n";
import { ensurePrivateFolder, writePrivateFile } from "@binference/platform";
import { createTempFolder, type TempFolder } from "@binference/platform/testing";
import { operations } from "@binference/protocol";
import { afterEach, describe, expect, it } from "vitest";
import { runCli } from "../program/run-cli.js";
import {
  connectClient,
  engineLogLines,
  freePort,
  hostOn,
  isUnlocked,
  type TestMachine,
  writeTestConfig,
} from "./test-host.js";

const nowMs = 1_800_000_000_000;
const slow = { timeout: 60_000 };
const folders: TempFolder[] = [];
const running: Promise<number>[] = [];

afterEach(async () => {
  // A test that failed half way still stops its engine before its folder goes.
  const machines = [...machinesInUse];
  machinesInUse.clear();
  machines.forEach((machine) => machine.signals.emit("SIGINT", "SIGINT"));
  await Promise.allSettled(running.splice(0));
  await Promise.all(folders.splice(0).map(async (folder) => folder.remove()));
});

const machinesInUse = new Set<TestMachine>();

async function newMachine(): Promise<TestMachine> {
  const folder = await createTempFolder("bnf-");
  folders.push(folder);
  const machine = {
    folder: folder.path,
    clock: createManualClock(nowMs),
    signals: new EventEmitter(),
  };
  machinesInUse.add(machine);
  return machine;
}

interface Started {
  readonly exit: Promise<number>;
  readonly ready: { readonly http: { readonly port: number }; readonly ipc: string };
  readonly stdout: () => string;
}

/** Runs `binference start --json` in the foreground and waits for its ready line. */
async function start(machine: TestMachine): Promise<Started> {
  const port = await freePort();
  const host = hostOn(machine, ["start", "--json", "--set", `engine.port=${String(port)}`]);
  const exit = runCli(host);
  running.push(exit);
  const line = await Promise.race([
    host.waitForLine((text) => text.includes('"state":"ready"')),
    exit.then(() => `failed: ${host.stdout()} ${host.stderr()}`),
  ]);
  return { exit, ready: JSON.parse(line) as Started["ready"], stdout: host.stdout };
}

async function run(machine: TestMachine, argv: readonly string[], env = {}) {
  const host = hostOn(machine, argv, env);
  const code = await runCli(host);
  return { code, stdout: host.stdout(), stderr: host.stderr() };
}

describe("binference start, status, health and logs end to end", () => {
  it(
    "serves the protocol in the foreground, shows its health signals and stops on a signal",
    slow,
    async () => {
      const machine = await newMachine();
      await writeTestConfig(machine.folder);
      const engine = await start(machine);
      expect(engine.ready.http.port).toBeGreaterThan(0);

      const status = await run(machine, ["status", "--json"]);
      expect(status.code).toBe(0);
      const answer = operations["engine/status"].result.parse(JSON.parse(status.stdout));
      expect(answer).toMatchObject({
        state: "ready",
        version: "2026.10.0-test",
        protocol: 1,
        frozen: false,
        agents: [],
      });
      expect(answer.health.map((signal) => signal.signal)).toStrictEqual([
        "event_loop",
        "memory",
        "logs",
        "custody",
        "prices",
        "wallets",
        "simulator",
        "executor",
        "positions",
      ]);
      expect(answer.health.slice(2)).toStrictEqual([
        { signal: "logs", state: "ok" },
        { signal: "custody", state: "fail" },
        { signal: "prices", state: "fail" },
        { signal: "wallets", state: "fail" },
        { signal: "simulator", state: "fail" },
        { signal: "executor", state: "fail" },
        { signal: "positions", state: "fail" },
      ]);

      const people = await run(machine, ["status"]);
      expect(people.stdout).toContain(
        "binference 2026.10.0-test is running, on protocol version 1.",
      );
      expect(people.stdout).toContain("  Custody (not built in yet): failing");
      const chinese = await run(machine, ["status"], { LANG: "zh_CN.UTF-8" });
      expect(chinese.stdout).toContain(String(messages.zh["cli.status.signals"]));

      await expect(run(machine, ["health"])).resolves.toMatchObject({
        code: 0,
        stdout: "binference is running and ready.\n",
      });

      machine.signals.emit("SIGINT", "SIGINT");
      await expect(engine.exit).resolves.toBe(0);
      expect(engine.stdout()).toContain('{"state":"stopped","unfinished":[]}');

      const after = await run(machine, ["health"]);
      expect(after.code).toBe(1);
      expect(after.stderr).toContain("binference is not running on the state folder");
      expect(isUnlocked(machine.folder)).toBe(true);
    },
  );

  it("refuses a second start on the same state folder while the first runs", slow, async () => {
    const machine = await newMachine();
    await writeTestConfig(machine.folder);
    const first = await start(machine);
    const port = await freePort();
    const second = await run(machine, ["start", "--set", `engine.port=${String(port)}`]);
    expect(second.code).toBe(1);
    expect(second.stderr).toBe(
      `binference already runs on the state folder ${machine.folder}. Stop it first, or set ` +
        "BINFERENCE_HOME to another folder.\n",
    );
    machine.signals.emit("SIGINT", "SIGINT");
    await expect(first.exit).resolves.toBe(0);
  });

  it("stops through engine/stop over IPC, the way that works on every OS", slow, async () => {
    const machine = await newMachine();
    await writeTestConfig(machine.folder);
    const engine = await start(machine);
    const client = await connectClient(machine);
    // The sequence closes the server that answers, so the reply may lose the race to the bye.
    const stopping = client.call("engine/stop", {}, { signal: live() }).catch(() => undefined);
    await expect(engine.exit).resolves.toBe(0);
    client.close();
    await stopping;
  });

  it("writes the engine log, which logs reads back as lines and as JSON", slow, async () => {
    const machine = await newMachine();
    await writeTestConfig(machine.folder);
    const engine = await start(machine);
    machine.signals.emit("SIGINT", "SIGINT");
    await engine.exit;

    const logs = await run(machine, ["logs", "--lines", "2"]);
    expect(logs.code).toBe(0);
    expect(logs.stdout.split("\n").filter((line) => line !== "")).toStrictEqual([
      "2027-01-15T08:00:00.000Z info  engine engine.ready",
      "2027-01-15T08:00:00.000Z info  engine engine.stopping",
    ]);
    const json = await run(machine, ["logs", "--json", "--lines", "1"]);
    expect(jsonValueSchema.parse(JSON.parse(json.stdout))).toStrictEqual({
      time: "2027-01-15T08:00:00.000Z",
      level: "info",
      subsystem: "engine",
      event: "engine.stopping",
    });
    const lines = await engineLogLines(machine);
    expect(lines.length).toBeGreaterThan(3);
    expect(lines.filter((line) => line.includes("bnt_"))).toStrictEqual([]);
  });

  it("names what the CLI is missing when it cannot sign in", slow, async () => {
    const machine = await newMachine();
    await writeTestConfig(machine.folder);
    const engine = await start(machine);
    const files = { permissions: { restrictFolder: noop, restrictFile: noop }, signal: live() };
    const tokenFile = join(machine.folder, "auth", "cli.token");

    await writePrivateFile(tokenFile, `bnt_${"A".repeat(43)}\n`, files);
    const refused = await run(machine, ["status"]);
    expect(refused).toMatchObject({ code: 1 });
    expect(refused.stderr).toContain("binference refused the CLI (auth.invalid).");

    await writePrivateFile(tokenFile, "not a token\n", files);
    const missing = await run(machine, ["status", "--json"]);
    expect(missing).toMatchObject({ code: 1, stdout: '{"error":{"code":"cli.no_sign_in"}}\n' });

    machine.signals.emit("SIGINT", "SIGINT");
    await expect(engine.exit).resolves.toBe(0);
  });

  it("names the fault of a start that fails, logs it and frees the folder", slow, async () => {
    const machine = await newMachine();
    await writeTestConfig(machine.folder);
    // A folder where engine.sqlite belongs makes the store fail to open.
    await ensurePrivateFolder(join(machine.folder, "engine.sqlite"), {
      permissions: { restrictFolder: noop, restrictFile: noop },
      signal: live(),
    });
    const failed = await run(machine, ["start", "--json"]);
    expect(failed.code).toBe(1);
    expect(failed.stdout).toMatch(/^\{"error":\{"code":"store\.[a-z_]+"\}\}\n$/);
    const lines = await engineLogLines(machine);
    expect(lines.filter((line) => line.includes('"event":"engine.start_failed"'))).toHaveLength(1);
    expect(isUnlocked(machine.folder)).toBe(true);
  });

  it(
    "refuses to start on a config with problems and leaves the folder unlocked",
    slow,
    async () => {
      const machine = await newMachine();
      const missing = await run(machine, ["start"]);
      expect(missing.code).toBe(1);
      expect(missing.stderr).toBe(
        "config.json5 has 1 problem. Fix each one, then start again.\n" +
          `${join(machine.folder, "config.json5")} does not exist.\n` +
          "Run `binference init` to write it.\n",
      );
      await writeTestConfig(machine.folder, '  engine: { port: "abc" },\n');
      const bad = await run(machine, ["start", "--json"]);
      expect(JSON.parse(bad.stdout)).toStrictEqual({
        error: {
          code: "config.invalid",
          details: [
            { path: "engine.port", problem: "bad_value", fix: "change_value", layer: "file" },
          ],
        },
      });
      expect(isUnlocked(machine.folder)).toBe(true);
    },
  );
});

const noop = async (): Promise<void> => Promise.resolve();
const live = (): AbortSignal => new AbortController().signal;
