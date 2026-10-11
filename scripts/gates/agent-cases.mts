import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { GateCase, GateStep } from "./gate-case.mjs";

function hook(file: string, expect: "pass" | "fail", output: readonly RegExp[]): GateStep {
  return {
    command: ["node", "scripts/edit-hook.mts"],
    input: JSON.stringify({ tool_name: "Write", tool_input: { file_path: file } }),
    expect,
    ...(expect === "fail" ? { status: 2 } : {}),
    output,
  };
}

/** Cases for pnpm setup, the edit hook and the agent files check:layout guards. */
export function agentCases(repo: string): readonly GateCase[] {
  const banned = readFileSync(join(repo, "config/style/banned-words.txt"), "utf8").split("\n")[0];
  const rules = readFileSync(join(repo, "AGENTS.md"), "utf8");
  // Every skill folder the repo ships, so the setup case follows new skills.
  const skills = readdirSync(join(repo, ".agents/skills"), { withFileTypes: true }).filter(
    (entry) => entry.isDirectory(),
  ).length;
  const linked = new RegExp(`links ${String(skills)} skills`);
  return [
    {
      name: "pnpm setup links the skills for Claude Code, twice in a row",
      steps: [
        { command: ["pnpm", "setup"], expect: "pass", output: [linked] },
        { command: ["pnpm", "setup"], expect: "pass", output: [linked] },
      ],
    },
    {
      name: "an edit with a banned word shows the hook's error to the agent",
      files: { "notes.md": `# Notes\n\nIt is ${String(banned)} to read.\n` },
      steps: [hook("notes.md", "fail", [/check:style\(banned-word\)/])],
    },
    {
      name: "a clean edit passes the hook",
      files: { "notes.md": "# Notes\n\nIt reads well.\n" },
      steps: [hook("notes.md", "pass", [])],
    },
    {
      name: "a listed skill without its SKILL.md fails check:layout",
      files: {
        "AGENTS.md": rules.replace(
          "- `write-adr`:",
          "- `add-gate-sample`: a skill that has no folder.\n- `write-adr`:",
        ),
      },
      steps: [
        { command: ["pnpm", "check:layout"], expect: "fail", output: [/skill add-gate-sample/] },
      ],
    },
    {
      name: "settings without the edit hook fail check:layout",
      files: { ".claude/settings.json": "{}\n" },
      steps: [{ command: ["pnpm", "check:layout"], expect: "fail", output: [/edit-hook\.mts/] }],
    },
  ];
}
