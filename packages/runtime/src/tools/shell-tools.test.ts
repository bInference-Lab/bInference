import { BinferenceError, type JsonValue } from "@binference/core";
import { describe, expect, it } from "vitest";
import { agent, callTool, outcomeOf } from "../testing/agent-tool-fixtures.js";

const job = "shj_0190f1c2-3a4b-7c5d-8e6f-000000000001";

function viewOf(fields: Readonly<Record<string, JsonValue | undefined>>): JsonValue {
  return Object.fromEntries(
    Object.entries({
      job,
      status: "ended",
      command: "ls -l",
      folder: "/Users/owner",
      startedAt: 1_000,
      endedAt: 1_200,
      exitCode: 0,
      timedOut: false,
      stopped: false,
      output: "total 0\n",
      outputCut: false,
      ...fields,
    }).filter(([, value]) => value !== undefined),
  );
}

describe("the shell tools", () => {
  it("run a command for the agent, its wait in milliseconds, and answer its output", async () => {
    const run = callTool(
      { "shell/run": viewOf({}) },
      { name: "shell", args: { command: "ls -l", waitSeconds: 5 } },
    );
    const outcome = await outcomeOf(run);
    expect(run.client.calls()).toStrictEqual([
      { op: "shell/run", args: { agent, command: "ls -l", waitMs: 5000 } },
    ]);
    expect(outcome).toStrictEqual({
      text: `Job ${job} ended with exit code 0, in /Users/owner.\ntotal 0\n`,
      isError: false,
      outside: true,
    });
  });

  it("say a command still runs as a job, and mark no empty output as outside", async () => {
    const answers = { "shell/run": viewOf({ status: "running", output: "" }) };
    const outcome = await outcomeOf(
      callTool(answers, { name: "shell", args: { command: "sleep 100", background: true } }),
    );
    expect(outcome.text).toContain("still runs in /Users/owner");
    expect(outcome.text).toContain("shell_job poll");
    expect(outcome.outside).toBe(false);
  });

  it("answer a failed command as an error, with what it printed", async () => {
    const answers = { "shell/run": viewOf({ exitCode: 2, output: "no such file\n" }) };
    const outcome = await outcomeOf(
      callTool(answers, { name: "shell", args: { command: "ls x" } }),
    );
    expect(outcome.isError).toBe(true);
    expect(outcome.text).toContain("exit code 2");
  });

  it("stop a job and say it was stopped", async () => {
    const run = callTool(
      { "shell/job": viewOf({ stopped: true, exitCode: undefined, signal: "SIGTERM" }) },
      { name: "shell_job", args: { job, action: "stop" } },
    );
    const outcome = await outcomeOf(run);
    expect(run.client.calls()).toStrictEqual([
      { op: "shell/job", args: { agent, job, action: "stop" } },
    ]);
    expect(outcome.text).toContain(`Job ${job} stopped`);
  });

  it("tell the model the owner turned the shell off, and not to work around it", async () => {
    const off = new BinferenceError({ code: "shell.off", message: "The shell is off." });
    const outcome = await outcomeOf(
      callTool({ "shell/run": off }, { name: "shell", args: { command: "ls" } }),
    );
    expect(outcome.isError).toBe(true);
    expect(outcome.text).toContain("never try another way");
  });

  it("refuse a wait past 20 seconds and an agent before the engine", () => {
    const longWait = callTool({}, { name: "shell", args: { command: "ls", waitSeconds: 30 } });
    const named = callTool({}, { name: "shell", args: { command: "ls", agent } });
    expect([longWait.refused, named.refused]).toStrictEqual([
      expect.stringMatching(/^not run: the arguments do not match/),
      expect.stringMatching(/^not run: the arguments do not match/),
    ]);
  });
});
