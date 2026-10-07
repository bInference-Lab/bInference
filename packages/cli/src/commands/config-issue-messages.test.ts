import { createFormatter, messages } from "@binference/i18n";
import { describe, expect, it } from "vitest";
import type { ConfigIssue, ConfigProblem } from "../config/config-issue.js";
import { configIssue } from "../config/config-issue.js";
import { configIssueMessages } from "./config-issue-messages.js";

const file = { layer: "file", name: "/srv/binference/config.json5" } as const;
const env = { layer: "env", name: "BINFERENCE_ENGINE_PORT" } as const;
const flag = { layer: "flag", name: "engine.port" } as const;

const problems: readonly ConfigProblem[] = [
  { kind: "missing_file" },
  { kind: "unreadable", line: 3, column: 7 },
  { kind: "newer_version", version: 9, supported: 2 },
  { kind: "older_version", version: 1, current: 2 },
  { kind: "unknown_key" },
  { kind: "required" },
  { kind: "bad_value", rule: { kind: "boolean" }, got: '"yes"' },
  { kind: "bad_value", rule: { kind: "boolean" }, got: "" },
  { kind: "bad_key", rule: { kind: "text" } },
  { kind: "secret_inline" },
  { kind: "bad_flag" },
];

const english = createFormatter({ locale: "en", timeZone: "UTC" });

function rendered(issue: ConfigIssue): readonly string[] {
  return configIssueMessages(issue).map(({ key, values }) => english.message(`cli.${key}`, values));
}

function englishOf(issue: ConfigIssue): readonly string[] {
  return configIssueMessages(issue).map(({ key }) => messages.en[`cli.${key}`] ?? `missing ${key}`);
}

describe("config issue messages", () => {
  it.each(problems.map((problem) => [problem.kind, problem] as const))(
    "has a message and a fix for %s",
    (_kind, problem) => {
      const texts = englishOf(configIssue(["engine", "port"], problem, file));
      expect(texts.filter((text) => text.startsWith("missing"))).toStrictEqual([]);
    },
  );

  it("names the file, the variable or the flag the value came from", () => {
    const bad: ConfigProblem = { kind: "bad_value", rule: { kind: "boolean" }, got: '"x"' };
    expect(rendered(configIssue(["engine", "port"], bad, file))).toStrictEqual([
      'engine.port holds a value it does not take (got "x").',
      `Set it in ${file.name} or remove it.`,
    ]);
    expect(rendered(configIssue(["engine", "port"], bad, env))).toStrictEqual([
      'engine.port (BINFERENCE_ENGINE_PORT) holds a value it does not take (got "x").',
      "Set BINFERENCE_ENGINE_PORT to a value it takes, or unset it.",
    ]);
    expect(rendered(configIssue(["engine"], { kind: "unknown_key" }, flag))).toStrictEqual([
      "engine is not a config key.",
      "Leave out the flag --set engine.port=, or check its spelling.",
    ]);
    expect(rendered(configIssue([], { kind: "bad_flag" }, flag))[0]).toBe(
      "The flag --set engine.port is not written as `--set key=value`.",
    );
  });

  it("reads a default's fix as the config file's", () => {
    const issue = configIssue(["telegram"], { kind: "required" }, { layer: "default", name: "" });
    expect(rendered(issue)).toStrictEqual(["telegram is required.", "Add it to config.json5."]);
  });

  it("names the line and column of a file that does not parse", () => {
    const issue = configIssue([], { kind: "unreadable", line: 3, column: 7 }, file);
    expect(rendered(issue)).toStrictEqual([
      `${file.name} is not valid JSON5 at line 3, column 7.`,
      `Fix ${file.name} at that place.`,
    ]);
  });
});
