import { createIdSource, err, type Result } from "@binference/core";
import { createManualClock, createSeededRandom } from "@binference/core/testing";
import {
  type ArgsOf,
  type ProtocolErrorCode,
  protocolIdSchema,
  type ResultOf,
} from "@binference/protocol";
import { describe, expect, it } from "vitest";
import { createFakeCommandRunner, type FakeCommand } from "../fakes/fake-command-runner.js";
import { testCall, testCallers } from "../operations/test-engine.js";
import { createShellHandlers, type ShellSettings } from "./shell-handlers.js";
import { createShellJobs } from "./shell-jobs.js";

const agent = protocolIdSchema("agent").parse("agt_0190f1c2-3a4b-7c5d-8e6f-000000000001");
const other = protocolIdSchema("agent").parse("agt_0190f1c2-3a4b-7c5d-8e6f-000000000002");
const on: ShellSettings = { run: "any", timeoutSeconds: 1800 };

// The view of an answer that must have one.
function viewOf(answer: Result<ResultOf<"shell/run">, ProtocolErrorCode>): ResultOf<"shell/run"> {
  if (!answer.ok) {
    throw new Error(`the shell refused: ${answer.error}`);
  }
  return answer.value;
}

function shellWith(script: Readonly<Record<string, FakeCommand>>, settings = on) {
  const clock = createManualClock(1_000);
  const ids = createIdSource({ clock, random: createSeededRandom(5) });
  const runner = createFakeCommandRunner({ script, words: new Set(["apple"]) });
  const jobs = createShellJobs({ clock, ids, mask: (text) => runner.mask(text) });
  const handlers = createShellHandlers({ runner, settings: () => settings, jobs, clock });
  const run = async (args: Omit<ArgsOf<"shell/run">, "agent">) =>
    handlers["shell/run"](testCall({ agent, ...args }, testCallers.runtime));
  const job = async (
    args: Omit<ArgsOf<"shell/job">, "agent"> & { readonly agent?: typeof agent },
  ) => handlers["shell/job"](testCall({ agent, ...args }, testCallers.runtime));
  return { clock, runner, run, job };
}

describe("shell/run", () => {
  it("answers a command that ended within its wait with its output and exit code", async () => {
    const { run } = shellWith({ "ls -l": { kind: "ends", output: "total 0\n", exitCode: 0 } });
    const answer = await run({ command: "ls -l" });
    expect(answer).toMatchObject({
      ok: true,
      value: {
        status: "ended",
        command: "ls -l",
        folder: "/home/owner",
        exitCode: 0,
        output: "total 0\n",
        outputCut: false,
      },
    });
  });

  it("answers a command still running once its wait is over, and stops it on shell/job", async () => {
    const { clock, run, job } = shellWith({ serve: { kind: "runs", output: "listening\n" } });
    const started = run({ command: "serve", waitMs: 2_000 });
    await clock.advance(2_000);
    const answer = await started;
    expect(answer).toMatchObject({ ok: true, value: { status: "running", output: "listening\n" } });
    const stopped = await job({ job: viewOf(answer).job, action: "stop" });
    expect(stopped).toMatchObject({
      ok: true,
      value: { status: "ended", stopped: true, signal: "SIGTERM", output: "" },
    });
  });

  it("answers at once in the background", async () => {
    const { run } = shellWith({ serve: { kind: "runs", output: "" } });
    expect(await run({ command: "serve", background: true })).toMatchObject({
      ok: true,
      value: { status: "running" },
    });
  });

  it("refuses while the shell is off, and in a folder that does not exist", async () => {
    const off = shellWith({}, { run: "off", timeoutSeconds: 1800 });
    expect(await off.run({ command: "ls" })).toStrictEqual(err("shell.off"));
    const { run, runner } = shellWith({});
    expect(await run({ command: "ls", folder: "/nowhere" })).toStrictEqual(
      err("shell.folder_missing"),
    );
    expect(runner.started).toStrictEqual([]);
  });

  it("masks a recovery phrase and keeps only the newest output, saying it cut", async () => {
    const phrase = Array.from({ length: 12 }, () => "apple").join(" ");
    const long = "x".repeat(200_010);
    const { run } = shellWith({
      phrase: { kind: "ends", output: `words: ${phrase}\n`, exitCode: 0 },
      long: { kind: "ends", output: long, exitCode: 0 },
    });
    expect(await run({ command: "phrase" })).toMatchObject({
      value: { output: "words: [recovery phrase hidden]\n" },
    });
    const cut = viewOf(await run({ command: "long" }));
    expect([cut.output.length, cut.outputCut]).toStrictEqual([200_000, true]);
  });
});

describe("shell/job", () => {
  it("never shows one agent's command to another", async () => {
    const { run, job } = shellWith({ serve: { kind: "runs", output: "" } });
    const answer = await run({ command: "serve", background: true });
    expect(await job({ agent: other, job: viewOf(answer).job, action: "poll" })).toStrictEqual(
      err("shell.job_not_found"),
    );
  });
});
