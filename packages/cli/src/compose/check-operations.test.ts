import { BinferenceError } from "@binference/core";
import {
  createManualClock,
  createMemoryLogger,
  createSeededRandom,
} from "@binference/core/testing";
import type { EngineCaller, EnginePush } from "@binference/engine";
import { describe, expect, it } from "vitest";
import type { CheckFinding } from "../commands/check-finding.js";
import { createCheckOperations } from "./check-operations.js";
import { createClosers } from "./closers.js";

const owner: EngineCaller = {
  credential: "dev_0190f1c2-3a4b-7c5d-8e6f-000000000001",
  client: { kind: "console", version: "test" },
  scopes: ["read", "admin"],
  transport: "ws",
};
const startMs = 1_767_261_600_000;
const configFile = "state/config.json5";

const findings: readonly CheckFinding[] = [
  { check: "config.valid", level: "ok", details: { file: configFile } },
  {
    check: "permissions.config_file",
    level: "fail",
    message: { key: "check.open", values: { path: configFile } },
    more: [],
  },
  {
    check: "models.priced",
    level: "warn",
    message: { key: "check.modelsUnpriced", values: { count: 1 } },
    more: [{ key: "check.modelUnpriced", values: { model: "router/eyes" } }],
  },
];

interface Args {
  readonly fix?: boolean;
  readonly only?: readonly string[];
}

// The operations over findings the test hands, with every push and every run counted.
function rig(run: (signal: AbortSignal) => Promise<readonly CheckFinding[]>) {
  const clock = createManualClock(startMs);
  const pushes: EnginePush[] = [];
  const runs: number[] = [];
  const waiting: { next?: () => void } = {};
  const handler = createCheckOperations({
    run: async (signal) => {
      runs.push(clock.now());
      return run(signal);
    },
    clock,
    random: createSeededRandom(5),
    publish: (push) => {
      pushes.push(push);
      waiting.next?.();
    },
    closers: createClosers(),
    logger: createMemoryLogger({ subsystem: "check" }),
  })["check/run"];
  if (handler === undefined) {
    throw new Error("Expected check/run.");
  }
  const call = async (args: Args) =>
    handler({ args, caller: owner, signal: new AbortController().signal });
  // The next push on the job topic.
  const nextEnd = async () =>
    new Promise<void>((resolve) => {
      waiting.next = resolve;
    });
  // Calls, then waits for the job's end.
  const ended = async (args: Args = {}) => {
    const end = nextEnd();
    const answer = await call(args);
    await end;
    return answer;
  };
  return { clock, pushes, runs, call, ended, nextEnd };
}

// The job a call answered, which every case here expects.
function jobOf(answer: {
  readonly ok: boolean;
  readonly value?: { readonly job: string };
}): string {
  if (answer.value === undefined) {
    throw new Error("Expected check/run to answer a job.");
  }
  return answer.value.job;
}

describe("the check run operation", () => {
  it("refuses a fix as one only the terminal runs, and runs nothing", async () => {
    const checks = rig(async () => Promise.resolve(findings));
    expect(await checks.call({ fix: true })).toStrictEqual({
      ok: false,
      error: "check.terminal_only",
    });
    expect(checks.runs).toStrictEqual([]);
  });

  it("ends its job with every finding's id, level and words, without their details", async () => {
    const checks = rig(async () => Promise.resolve(findings));
    const job = jobOf(await checks.ended());
    expect(checks.pushes).toStrictEqual([
      {
        topic: "job",
        kind: "job/done",
        data: {
          job,
          op: "check/run",
          result: {
            findings: [
              { check: "config.valid", level: "ok" },
              {
                check: "permissions.config_file",
                level: "fail",
                message: { key: "check.open", values: { path: configFile } },
              },
              {
                check: "models.priced",
                level: "warn",
                message: { key: "check.modelsUnpriced", values: { count: 1 } },
                more: [{ key: "check.modelUnpriced", values: { model: "router/eyes" } }],
              },
            ],
            ranAt: startMs,
          },
        },
      },
    ]);
  });

  it("answers from its report for 60 seconds, then runs the checks again", async () => {
    const checks = rig(async () => Promise.resolve(findings));
    await checks.ended();
    await checks.clock.advance(59_999);
    await checks.ended({ only: ["models.priced"] });
    await checks.clock.advance(1);
    await checks.ended();
    expect(checks.runs).toStrictEqual([startMs, startMs + 60_000]);
    expect(checks.pushes[1]?.data).toMatchObject({
      result: { findings: [{ check: "models.priced" }], ranAt: startMs },
    });
  });

  it("runs one at a time: a call while a run goes on gets its job", async () => {
    const release: { done?: () => void } = {};
    const checks = rig(
      async () =>
        new Promise((resolve) => {
          release.done = () => resolve(findings);
        }),
    );
    const end = checks.nextEnd();
    const first = await checks.call({});
    const second = await checks.call({});
    expect(second).toStrictEqual(first);
    release.done?.();
    await end;
    expect(checks.runs).toHaveLength(1);
    expect(checks.pushes).toHaveLength(1);
  });

  it("keeps at most 200 findings", async () => {
    const many = Array.from({ length: 250 }, (_unused, at): CheckFinding => ({
      check: `planted.${String(at)}`,
      level: "ok",
    }));
    const checks = rig(async () => Promise.resolve(many));
    await checks.ended();
    expect(checks.pushes[0]?.data).toMatchObject({ result: { findings: many.slice(0, 200) } });
  });

  it("ends its job failed when the checks run past their budget", async () => {
    const thrown = new BinferenceError({ code: "core.timeout", message: "Too slow." });
    const checks = rig(async () => Promise.reject(thrown));
    const job = jobOf(await checks.ended());
    expect(checks.pushes).toStrictEqual([
      {
        topic: "job",
        kind: "job/failed",
        data: {
          job,
          op: "check/run",
          error: { code: "engine.timeout", message: "The checks did not finish.", retryable: true },
        },
      },
    ]);
  });
});
