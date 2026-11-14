import type { FakeAnswers } from "./fake-client";

// What a checks screen test's engine answers (decision 0445): a job at once, whose end the test
// pushes on the `job` topic, as the engine does once the checks ran.

const job = "job_0190f1c2-3a4b-7c5d-8e6f-000000000001";

const report = {
  findings: [
    { check: "config.valid", level: "ok" },
    {
      check: "permissions.config_file",
      level: "fail",
      message: { key: "check.open", values: { path: "state/config.json5" } },
    },
    {
      check: "models.priced",
      level: "warn",
      message: { key: "check.modelsUnpriced", values: { count: 1 } },
      more: [{ key: "check.modelUnpriced", values: { model: "router/eyes" } }],
    },
    {
      check: "models.images",
      level: "ok",
      message: { key: "check.modelImages.reads", values: { model: "router/eyes" } },
    },
    { check: "rpc.keyed", level: "skip" },
  ],
  ranAt: Date.UTC(2026, 10, 14, 8, 30),
};

/** The job a checks test's engine answers, the report it ends with, and a failed end. */
export const checksFixture = {
  job,
  done: { job, op: "check/run", result: report },
  failed: {
    job,
    op: "check/run",
    error: { code: "engine.timeout", message: "The checks did not finish.", retryable: true },
  },
} as const;

/** The fake engine's answers for the checks screen. */
export const checksAnswers: FakeAnswers = {
  "check/run": () => ({ job }),
};
