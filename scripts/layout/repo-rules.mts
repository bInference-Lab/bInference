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

function listedSkills(repo: RepoView): readonly string[] {
  const text = readFileSync(join(repo.root, "AGENTS.md"), "utf8");
  const section = text.split(/^## /m).find((part) => part.startsWith("Skills\n")) ?? "";
  return [...section.matchAll(/^- `([a-z0-9-]+)`/gm)].map((match) => match[1] ?? "");
}

/** Every skill the root AGENTS.md lists exists under .agents/skills. */
export function listedSkillProblems(repo: RepoView): LayoutProblem[] {
  return listedSkills(repo)
    .filter((name) => !repo.files.includes(`.agents/skills/${name}/SKILL.md`))
    .map((name) =>
      problem("skill", `AGENTS.md lists the skill ${name}; add .agents/skills/${name}/SKILL.md.`),
    );
}

const settingsSchema = z.looseObject({
  hooks: z
    .looseObject({
      PostToolUse: z
        .array(
          z.looseObject({
            matcher: z.string(),
            hooks: z.array(z.looseObject({ type: z.string(), command: z.string() })),
          }),
        )
        .optional(),
    })
    .optional(),
});

/** The edit hook in .claude/settings.json runs on every edit and write. */
export function hookProblems(repo: RepoView): LayoutProblem[] {
  const file = join(repo.root, ".claude", "settings.json");
  const settings = existsSync(file)
    ? settingsSchema.safeParse(JSON.parse(readFileSync(file, "utf8")))
    : undefined;
  const entries = settings?.success === true ? (settings.data.hooks?.PostToolUse ?? []) : [];
  const hooked = entries.some(
    (entry) =>
      ["Edit", "Write"].every((tool) => entry.matcher.split("|").includes(tool)) &&
      entry.hooks.some((hook) => hook.command.includes("scripts/edit-hook.mts")),
  );
  return hooked
    ? []
    : [
        problem(
          "hook",
          ".claude/settings.json must run scripts/edit-hook.mts after Edit and Write.",
        ),
      ];
}
