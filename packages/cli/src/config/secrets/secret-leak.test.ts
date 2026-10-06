import { inspect } from "node:util";
import { createManualClock } from "@binference/core/testing";
import { createMemorySecretStore } from "@binference/platform/testing";
import { describe, expect, it } from "vitest";
import type { ConfigIssue } from "../config-issue.js";
import { formatConfigIssue } from "../format-config-issue.js";
import { loadConfig } from "../load-config.js";
import type { ConfigOutcome } from "../validate-config.js";
import { createSecretReader } from "./secret-reader.js";

// No redaction pattern matches this value, so only the code under test can keep it hidden.
const secret = "correct-horse-battery-staple-4417";
const signal = (): AbortSignal => new AbortController().signal;

// Everything a log line or an error report could print about a value.
function printed(value: unknown): string {
  return [
    inspect(value, { depth: null, showHidden: true }),
    JSON.stringify(value, (_key, item: unknown) =>
      typeof item === "bigint" ? String(item) : item,
    ),
    value instanceof Error ? `${value.message}\n${value.stack ?? ""}` : "",
  ].join("\n");
}

async function failure(run: Promise<unknown>): Promise<unknown> {
  return run.then(
    () => new Error("expected a failure"),
    (error: unknown) => error,
  );
}

function issuesOf(outcome: ConfigOutcome): readonly ConfigIssue[] {
  return outcome.ok ? [] : outcome.issues;
}

const reader = createSecretReader({
  env: {},
  keychain: createMemorySecretStore({}),
  homeDir: "/srv/owner",
  clock: createManualClock(0),
});

describe("secrets in logs and errors", () => {
  it("keeps a failing program's output out of the error", async () => {
    const program = [
      process.execPath,
      "-e",
      `process.stdout.write(${JSON.stringify(secret)}); process.stderr.write(${JSON.stringify(secret)}); process.exit(3)`,
    ];
    const error = await failure(
      reader.read("telegram.botToken", { fromCommand: program }, signal()),
    );
    expect(error).toMatchObject({
      code: "config.secret_unavailable",
      details: { reason: "failed" },
    });
    expect(printed(error)).not.toContain(secret);
  });

  it("reads a real program's output and never prints it", async () => {
    const program = [
      process.execPath,
      "-e",
      `process.stdout.write(${JSON.stringify(`${secret}\n`)})`,
    ];
    const read = await reader.read("telegram.botToken", { fromCommand: program }, signal());
    expect(read.reveal()).toBe(secret);
    expect(printed({ token: read, list: [read] })).not.toContain(secret);
  });

  it("keeps a plain-text secret from the file or a variable out of every issue", async () => {
    const outcome = await loadConfig({
      file: "/srv/binference/config.json5",
      env: { BINFERENCE_CUSTODY__PRIVY__APP_SECRET: secret },
      sets: [`network.proxy=${secret}`],
      system: { locale: "en", timezone: "UTC", unlockMode: "file" },
      signal: signal(),
      readFile: async () =>
        Promise.resolve({ ok: true, value: `{ telegram: { botToken: "${secret}" } }` } as const),
    });
    const issues = issuesOf(outcome);
    expect(issues.map((issue) => [issue.path, issue.problem.kind])).toStrictEqual([
      ["custody.privy.appSecret", "secret_inline"],
      ["telegram.botToken", "secret_inline"],
      ["network.proxy", "secret_inline"],
    ]);
    expect(printed(outcome)).not.toContain(secret);
    expect(issues.map(formatConfigIssue).join("\n")).not.toContain(secret);
  });
});
