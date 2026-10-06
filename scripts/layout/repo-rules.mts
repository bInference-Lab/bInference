import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";
import { z } from "zod";
import { runCommand } from "../run-command.mjs";
import type { LayoutProblem, RepoView } from "./layout-rules.mjs";

function problem(rule: string, message: string): LayoutProblem {
  return { rule, message };
}

/** Line endings are LF on every OS, and personal Claude notes never reach git. */
export function repoSettingProblems(repo: RepoView): LayoutProblem[] {
  const attributes = join(repo.root, ".gitattributes");
  const lines = existsSync(attributes) ? readFileSync(attributes, "utf8").split("\n") : [];
  const ignored = runCommand(["git", "check-ignore", "-q", "CLAUDE.local.md"], { cwd: repo.root });
  return [
    ...(lines.includes("* text=auto eol=lf")
      ? []
      : [problem("gitattributes", ".gitattributes must hold the line: * text=auto eol=lf")]),
    ...(ignored.status === 0
      ? []
      : [problem("claude-local", "CLAUDE.local.md must be git-ignored.")]),
  ];
}

const frontmatterSchema = z.looseObject({
  name: z.string().min(1),
  description: z.string().min(1),
});

function skillProblem(repo: RepoView, folder: string): LayoutProblem | undefined {
  const file = `${folder}/SKILL.md`;
  if (!repo.files.includes(file)) {
    return problem("skill", `${folder} has no SKILL.md.`);
  }
  const match = /^---\n([\s\S]*?)\n---\n/.exec(readFileSync(join(repo.root, file), "utf8"));
  const parsed = frontmatterSchema.safeParse(parse(match?.[1] ?? ""));
  if (!parsed.success) {
    return problem("skill", `${file} needs frontmatter with a name and a description.`);
  }
  const name = folder.split("/").at(-1);
  return parsed.data.name === name
    ? undefined
    : problem("skill", `${file} is named ${parsed.data.name}; its folder is ${String(name)}.`);
}

/** Each skill under .agents/skills has a SKILL.md whose name matches its folder. */
export function skillProblems(repo: RepoView): LayoutProblem[] {
  const folders = new Set(
    repo.files
      .map((file) => /^(\.agents\/skills\/[^/]+)\//.exec(file)?.[1])
      .filter((folder) => folder !== undefined),
  );
  return [...folders]
    .map((folder) => skillProblem(repo, folder))
    .filter((item) => item !== undefined);
}
