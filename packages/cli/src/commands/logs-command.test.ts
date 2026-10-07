import { EventEmitter } from "node:events";
import { join } from "node:path";
import { createManualClock } from "@binference/core/testing";
import { ensurePrivateFolder, openLogFile } from "@binference/platform";
import { createTempFolder, type TempFolder } from "@binference/platform/testing";
import { afterEach, describe, expect, it } from "vitest";
import { hostOn, type TestMachine } from "../e2e/test-host.js";
import { logLineSchema } from "../logging/log-line.schema.js";
import { runCli } from "../program/run-cli.js";
import { formatLogLine } from "./logs-command.js";

const folders: TempFolder[] = [];
const signal = new AbortController().signal;
const permissions = {
  restrictFolder: async () => Promise.resolve(),
  restrictFile: async () => Promise.resolve(),
};

afterEach(async () => {
  await Promise.all(folders.splice(0).map(async (folder) => folder.remove()));
});

function line(event: string): string {
  return JSON.stringify({
    time: "2027-01-15T08:00:00.000Z",
    level: "warn",
    subsystem: "engine.server",
    event,
    fields: { errorCode: "server.busy", durationMs: 4 },
  });
}

async function machineWithLog(lines: readonly string[]) {
  const folder = await createTempFolder("bnf-logs-");
  folders.push(folder);
  const machine: TestMachine = {
    folder: folder.path,
    clock: createManualClock(),
    signals: new EventEmitter(),
  };
  await ensurePrivateFolder(join(folder.path, "logs"), { permissions, signal });
  const file = openLogFile({
    file: join(folder.path, "logs", "engine.log"),
    maxBytes: 1_000_000,
    keepMs: 1,
    clock: machine.clock,
  });
  lines.forEach((text) => file.append(text));
  await file.flush();
  return { machine, file };
}

describe("binference logs", () => {
  it("writes a log line as time, level, subsystem, event and ids", () => {
    expect(formatLogLine(logLineSchema.parse(JSON.parse(line("server.slow"))))).toBe(
      "2027-01-15T08:00:00.000Z warn  engine.server server.slow errorCode=server.busy durationMs=4",
    );
  });

  it("prints the last lines, a line it cannot read as it is", async () => {
    const { machine } = await machineWithLog([line("one"), "not json", line("three")]);
    const host = hostOn(machine, ["logs", "-n", "2"]);
    await expect(runCli(host)).resolves.toBe(0);
    expect(host.stdout()).toBe(
      "not json\n" +
        "2027-01-15T08:00:00.000Z warn  engine.server three errorCode=server.busy durationMs=4\n",
    );
  });

  it("follows new lines until a stop signal", async () => {
    const { machine, file } = await machineWithLog([line("before")]);
    const host = hostOn(machine, ["logs", "--follow", "--json", "-n", "1"]);
    const exit = runCli(host);
    await host.waitForLine((text) => text.includes('"before"'));
    file.append(line("after"));
    await file.flush();
    const clock = machine.clock as ReturnType<typeof createManualClock>;
    await clock.advance(500);
    await host.waitForLine((text) => text.includes('"after"'));
    machine.signals.emit("SIGINT", "SIGINT");
    await clock.advance(500);
    await expect(exit).resolves.toBe(0);
    expect(
      host
        .stdout()
        .split("\n")
        .filter((text) => text !== ""),
    ).toHaveLength(2);
  });
});
