import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { runCommand, type CommandResult } from "./run-command.mjs";

/** One Oxlint JS plugin, the rules to turn on with their options, and where to run them. */
export interface PluginRun {
  readonly plugin: string;
  readonly rules: Readonly<Record<string, readonly [string, ...object[]]>>;
  readonly folders: readonly string[];
}

/**
 * Runs Oxlint with only the given plugin rules over the folders, tests left out, through a config
 * written to a scratch folder. The output is Oxlint's unix format, one finding per line.
 */
export function runPluginRules(root: string, run: PluginRun): CommandResult {
  const scratch = mkdtempSync(join(tmpdir(), "binference-oxlint-"));
  try {
    const config = join(scratch, "oxlintrc.json");
    const rules = {
      plugins: [],
      jsPlugins: [resolve(root, run.plugin)],
      categories: { correctness: "off", suspicious: "off", perf: "off" },
      rules: run.rules,
    };
    writeFileSync(config, JSON.stringify(rules));
    const oxlint = join("node_modules", "oxlint", "bin", "oxlint");
    return runCommand(
      [
        "node",
        oxlint,
        "-c",
        config,
        "--ignore-pattern",
        "**/*.test.ts",
        "--format",
        "unix",
        ...run.folders,
      ],
      { cwd: root },
    );
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}
