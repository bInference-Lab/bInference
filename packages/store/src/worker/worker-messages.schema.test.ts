import { describe, expect, it } from "vitest";
import { migrationReportSchema } from "../migrations/migration-report.js";
import {
  workerMessageSchema,
  workerRequestSchema,
  workerSetupSchema,
} from "./worker-messages.schema.js";

const error = {
  code: "store.newer_schema",
  message: "newer",
  retryable: false,
  details: { schemaVersion: 3 },
};

describe("worker message schemas", () => {
  it.each([
    { role: "writer", file: "/state/engine.sqlite" },
    { role: "reader", file: "/state/agent.sqlite" },
  ])("accept the setup $role", (setup) => {
    expect(workerSetupSchema.parse(setup)).toStrictEqual(setup);
  });

  it.each([
    { id: 0, kind: "task", task: "ledger.append", input: { amount: 1n } },
    { id: 1, kind: "migrate" },
    { id: 2, kind: "integrity" },
    { id: 3, kind: "vacuum", target: "/state/backups/copy.sqlite" },
    { id: 4, kind: "close" },
  ])("accept the request $kind", (request) => {
    expect(workerRequestSchema.parse(request)).toStrictEqual(request);
  });

  it.each([
    { kind: "ready", database: "engine", schemaVersion: 0, latestVersion: 1 },
    { kind: "refused", error },
    { kind: "reply", id: 7, ok: true, value: [1, "two"] },
    { kind: "reply", id: 8, ok: false, error },
  ])("accept the message $kind", (message) => {
    expect(workerMessageSchema.parse(message)).toStrictEqual(message);
  });

  it("accepts a migration report", () => {
    const report = { from: 0, to: 2, applied: ["0001_meta", "0002_notes"] };

    expect(migrationReportSchema.parse(report)).toStrictEqual(report);
  });

  it.each([
    [workerSetupSchema, { role: "owner", file: "/state/engine.sqlite" }],
    [workerRequestSchema, { id: -1, kind: "migrate" }],
    [workerRequestSchema, { id: 1, kind: "drop" }],
    [workerMessageSchema, { kind: "refused", error: { ...error, code: "NotDotted" } }],
    [workerMessageSchema, { kind: "reply", id: 1, ok: true }],
  ])("refuse a malformed message %#", (schema, value) => {
    expect(schema.safeParse(value).success).toBe(false);
  });
});
