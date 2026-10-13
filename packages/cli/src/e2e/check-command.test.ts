import { messages } from "@binference/i18n";
import { afterEach, describe, expect, it } from "vitest";
import { platformOf } from "../compose/engine-locations.js";
import { runCli } from "../program/run-cli.js";
import {
  createTestMachines,
  freePort,
  hostOn,
  runOn,
  type TestMachine,
  writeTestConfig,
} from "./test-host.js";

const slow = { timeout: 60_000 };
const nowMs = 1_800_000_000_000;
const machines = createTestMachines();
const engines: { readonly machine: TestMachine; readonly exit: Promise<number> }[] = [];

afterEach(async () => {
  engines.forEach(({ machine }) => machine.signals.emit("SIGINT", "SIGINT"));
  await Promise.allSettled(engines.splice(0).map(async ({ exit }) => exit));
  await machines.removeAll();
});

interface Finding {
  readonly check: string;
  readonly level: string;
}

async function findings(machine: TestMachine, argv: readonly string[] = []) {
  const checked = await runOn(machine, ["check", "--json", ...argv]);
  const parsed = JSON.parse(checked.stdout) as { readonly findings: readonly Finding[] };
  const byCheck = new Map(parsed.findings.map((finding) => [finding.check, finding]));
  return { code: checked.code, byCheck };
}

async function start(machine: TestMachine): Promise<void> {
  const host = hostOn(machine, [
    "start",
    "--foreground",
    "--json",
    "--set",
    `engine.port=${String(await freePort())}`,
  ]);
  const exit = runCli(host);
  engines.push({ machine, exit });
  await host.waitForLine((line) => line.includes('"state":"ready"'));
}

// The file unlock mode, whatever the machine running the test would choose.
const fileUnlock = '  engine: { unlock: { mode: "file" } },\n';

describe("binference check", () => {
  it(
    "checks the config, the unlock mode and the engine, with or without the engine running",
    slow,
    async () => {
      const machine = await machines.create(nowMs);
      await writeTestConfig(machine.folder, fileUnlock);
      const stopped = await findings(machine);
      expect(stopped.code).toBe(0);
      expect(stopped.byCheck.get("config.valid")).toStrictEqual({
        check: "config.valid",
        level: "ok",
      });
      expect(stopped.byCheck.get("unlock.mode")).toStrictEqual({
        check: "unlock.mode",
        level: "warn",
        mode: "file",
      });
      expect(stopped.byCheck.get("engine.reachable")).toStrictEqual({
        check: "engine.reachable",
        level: "warn",
        code: "engine.not_running",
      });
      expect(stopped.byCheck.get("rpc.keyed")).toStrictEqual({ check: "rpc.keyed", level: "skip" });
      expect(stopped.byCheck.get("rpc.pushed")).toStrictEqual({
        check: "rpc.pushed",
        level: "skip",
      });
      await start(machine);
      const running = await findings(machine);
      expect(running.byCheck.get("engine.reachable")).toStrictEqual({
        check: "engine.reachable",
        level: "ok",
        version: "2026.10.0-test",
      });
      expect(running.byCheck.get("rpc.keyed")).toStrictEqual({ check: "rpc.keyed", level: "ok" });
      expect(running.byCheck.get("rpc.pushed")).toStrictEqual({ check: "rpc.pushed", level: "ok" });
    },
  );

  it("names each config problem with its fix, and exits 1", slow, async () => {
    const machine = await machines.create(nowMs);
    await writeTestConfig(machine.folder, '  engine: { port: "abc" },\n');
    const people = await runOn(machine, ["check"]);
    expect(people.code).toBe(1);
    expect(people.stdout).toContain(
      "Problems:\n  config.json5 has 1 problem:\n  engine.port holds a value it does not take " +
        '(got "abc").\n',
    );
    const json = await findings(machine);
    expect(json.byCheck.get("config.valid")).toStrictEqual({
      check: "config.valid",
      level: "fail",
      issues: [{ path: "engine.port", problem: "bad_value", fix: "change_value", layer: "file" }],
    });
    expect(json.byCheck.has("unlock.mode")).toBe(false);
  });

  it("says what the ceiling promises, in the owner's language", slow, async () => {
    const machine = await machines.create(nowMs);
    await writeTestConfig(machine.folder);
    const english = await runOn(machine, ["check"]);
    const chinese = await runOn(machine, ["check"], { LANG: "zh_CN.UTF-8" });

    expect(english.stdout).toContain(`${String(messages.en["cli.check.ceilingPromise"])}\n`);
    expect(chinese.stdout).toContain(`${String(messages.zh["cli.check.ceilingPromise"])}\n`);
  });

  it("leaves no path others can open after --fix", slow, async () => {
    const machine = await machines.create(nowMs);
    await writeTestConfig(machine.folder);
    const fixed = await findings(machine, ["--fix"]);
    const permissions = [...fixed.byCheck.values()].filter((finding) =>
      finding.check.startsWith("permissions."),
    );
    expect(permissions.map((finding) => finding.check)).toStrictEqual([
      "permissions.state_folder",
      "permissions.config_file",
    ]);
    expect(permissions.filter((finding) => finding.level === "fail")).toStrictEqual([]);
    expect(fixed.code).toBe(0);
  });

  it("warns in file unlock mode in the owner's language", slow, async () => {
    const machine = await machines.create(nowMs);
    await writeTestConfig(machine.folder, fileUnlock);
    const chinese = await runOn(machine, ["check"], { LANG: "zh_CN.UTF-8" });
    const keys = platformOf(hostOn(machine, [])).stateFolder.keys;
    const warning = String(messages.zh["cli.check.unlockFile"]).replace("{folder}", keys);
    expect(chinese.stdout).toContain(`  ${warning}\n`);
  });

  it(
    "names each configured model with no price, which counts $0 against the budget",
    slow,
    async () => {
      const machine = await machines.create(nowMs);
      const models = [
        "  models: {",
        '    providers: { claude: { kind: "anthropic" }, local: { kind: "openai" } },',
        '    main: "claude/claude-sonnet-4-6",',
        '    fast: "local/llama-4",',
        '    fallbacks: { main: ["local/qwen-9", "local/llama-4"] },',
        '    prices: { "local/llama-4": { inputPerMTokUsd: "0.1", outputPerMTokUsd: "0.2", cachedPerMTokUsd: "0" } },',
        "  },\n",
      ].join("\n");
      await writeTestConfig(machine.folder, models);
      const checked = await findings(machine);
      const english = await runOn(machine, ["check"]);

      expect(checked.byCheck.get("models.priced")).toStrictEqual({
        check: "models.priced",
        level: "warn",
        models: ["local/qwen-9"],
      });
      expect(checked.code).toBe(0);
      expect(english.stdout).toContain("  local/qwen-9: its provider reports no cost");
    },
  );
});
