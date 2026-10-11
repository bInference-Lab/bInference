import { describe, expect, it } from "vitest";
import { ids } from "../examples/wire-values.js";
import { jobDonePushSchema, jobFailedPushSchema } from "./job-push.schema.js";

const { job, backup } = ids;

describe("the end of a job", () => {
  it("reads a done job with the result its operation names", () => {
    const result = { backup, kind: "manual", bytes: 4_096, createdAt: 1 };
    expect(jobDonePushSchema.parse({ job, op: "backup/create", result })).toStrictEqual({
      job,
      op: "backup/create",
      result,
    });
  });

  it("reads a failed job with its error, and refuses one without a job id", () => {
    const error = { code: "backup.write_failed", message: "disk", retryable: true };
    expect(jobFailedPushSchema.parse({ job, op: "backup/create", error })).toStrictEqual({
      job,
      op: "backup/create",
      error,
    });
    expect(jobFailedPushSchema.safeParse({ op: "backup/create", error }).success).toBe(false);
  });
});
