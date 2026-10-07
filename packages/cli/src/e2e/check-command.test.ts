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
    "--json",
    "--set",
    `engine.port=${String(await freePort())}`,
  ]);
  const exit = runCli(host);
  engines.push({ machine, exit });
  await host.waitForLine((line) => line.includes('"state":"ready"'));
}

describe("binference check", () => {
  it(
    "checks the config, the unlock mode and the engine, with or without the engine running",
    slow,
    async () => {
      const machine = await machines.create(nowMs);
      await writeTestConfig(machine.folder);
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
      await start(machine);
      const running = await findings(machine);
      expect(running.byCheck.get("engine.reachable")).toStrictEqual({
        check: "engine.reachable",
        level: "ok",
        version: "2026.10.0-test",
      });
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
    await writeTestConfig(machine.folder);
    const chinese = await runOn(machine, ["check"], { LANG: "zh_CN.UTF-8" });
    const keys = platformOf(hostOn(machine, [])).stateFolder.keys;
    const warning = String(messages.zh["cli.check.unlockFile"]).replace("{folder}", keys);
    expect(chinese.stdout).toContain(`  ${warning}\n`);
  });
});
