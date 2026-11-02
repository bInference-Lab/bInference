// Claude Code runs this after each edit and shows what it prints on stderr to the agent. It runs
// on Node directly, without tsx, so it imports no repo module and finds the repo from its own path.
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

interface Check {
  readonly name: string;
  readonly args: readonly string[];
  readonly applies: (file: string) => boolean;
}

const hookRoot = fileURLToPath(new URL("..", import.meta.url));
const lintable = /\.(?:[cm]?[jt]sx?)$/;
const formattable = /\.(?:[cm]?[jt]sx?|json|jsonc|md|ya?ml)$/;

function editedFile(input: string): string | undefined {
  const event: unknown = JSON.parse(input || "{}");
  if (typeof event !== "object" || event === null || !("tool_input" in event)) {
    return undefined;
  }
  const toolInput: unknown = event.tool_input;
  if (typeof toolInput !== "object" || toolInput === null || !("file_path" in toolInput)) {
    return undefined;
  }
  return typeof toolInput.file_path === "string" ? toolInput.file_path : undefined;
}

// The checkout the edited file belongs to. A worktree lives inside the main checkout, and checks
// run from the main one load both trees' Oxlint configs, which register the guards plugin twice.
function checkoutOf(path: string): string | undefined {
  const top = spawnSync("git", ["rev-parse", "--show-toplevel"], {
    cwd: existsSync(path) ? dirname(path) : hookRoot,
    encoding: "utf8",
  });
  return top.status === 0 ? top.stdout.trim() : undefined;
}

function bin(root: string, name: string): string {
  return join(root, "node_modules", name, "bin", name);
}

function checks(root: string, file: string): readonly Check[] {
  return [
    {
      name: "oxfmt",
      args: [bin(root, "oxfmt"), "--write", file],
      applies: (path) => formattable.test(path),
    },
    {
      name: "Oxlint",
      args: [
        bin(root, "oxlint"),
        "--type-aware",
        "--tsconfig",
        "tsconfig.json",
        "--format",
        "unix",
        file,
      ],
      applies: (path) => lintable.test(path),
    },
    {
      name: "check:style",
      args: ["--import", "tsx", "scripts/check-style.mts", "--files", file],
      applies: () => true,
    },
  ];
}

function run(root: string, check: Check): string | undefined {
  const result = spawnSync(process.execPath, check.args, { cwd: root, encoding: "utf8" });
  if (result.status === 0) {
    return undefined;
  }
  return `${check.name} failed:\n${`${result.stdout}${result.stderr}`.trim()}`;
}

// Files outside the repo and files git ignores, such as private notes, are not the repo's text.
function isRepoFile(root: string, file: string): boolean {
  if (file.startsWith("..") || isAbsolute(file) || !existsSync(join(root, file))) {
    return false;
  }
  return spawnSync("git", ["check-ignore", "-q", file], { cwd: root }).status !== 0;
}

const target = editedFile(readFileSync(0, "utf8"));
const path = target === undefined ? undefined : resolve(hookRoot, target);
const root = path === undefined ? undefined : checkoutOf(path);
const file = path === undefined || root === undefined ? undefined : relative(root, path);
if (root !== undefined && file !== undefined && isRepoFile(root, file)) {
  const failures = checks(root, file.replaceAll("\\", "/"))
    .filter((check) => check.applies(file))
    .map((check) => run(root, check))
    .filter((failure) => failure !== undefined);
  if (failures.length > 0) {
    console.error(failures.join("\n\n"));
    process.exitCode = 2;
  }
}
