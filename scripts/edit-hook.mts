// Claude Code runs this after each edit and shows what it prints on stderr to the agent. It runs
// on Node directly, without tsx, so it imports no repo module and finds the repo from its own path.
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

interface Check {
  readonly name: string;
  readonly args: readonly string[];
  readonly applies: (file: string) => boolean;
}

const root = fileURLToPath(new URL("..", import.meta.url));
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

function bin(name: string): string {
  return join(root, "node_modules", name, "bin", name);
}

function checks(file: string): readonly Check[] {
  return [
    {
      name: "oxfmt",
      args: [bin("oxfmt"), "--write", file],
      applies: (path) => formattable.test(path),
    },
    {
      name: "Oxlint",
      args: [
        bin("oxlint"),
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

function run(check: Check): string | undefined {
  const result = spawnSync(process.execPath, check.args, { cwd: root, encoding: "utf8" });
  if (result.status === 0) {
    return undefined;
  }
  return `${check.name} failed:\n${`${result.stdout}${result.stderr}`.trim()}`;
}

// Files outside the repo and files git ignores, such as private notes, are not the repo's text.
function isRepoFile(file: string): boolean {
  if (file.startsWith("..") || isAbsolute(file) || !existsSync(join(root, file))) {
    return false;
  }
  return spawnSync("git", ["check-ignore", "-q", file], { cwd: root }).status !== 0;
}

const target = editedFile(readFileSync(0, "utf8"));
const file = target === undefined ? undefined : relative(root, resolve(root, target));
if (file !== undefined && isRepoFile(file)) {
  const failures = checks(file.replaceAll("\\", "/"))
    .filter((check) => check.applies(file))
    .map(run)
    .filter((failure) => failure !== undefined);
  if (failures.length > 0) {
    console.error(failures.join("\n\n"));
    process.exitCode = 2;
  }
}
