import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { runCommand } from "./run-command.mjs";

/** A throwaway copy of the repo where gates run against planted violations. */
export interface Sandbox {
  readonly root: string;
  /** Writes files, paths relative to the sandbox root. */
  plant(files: Readonly<Record<string, string>>): void;
  /** Commits the current state, so later cases and git-based checks start from it. */
  commit(message: string): void;
  /** Drops every change and commit since the sandbox was made. */
  reset(): void;
  /** Deletes the sandbox. */
  dispose(): void;
}

const gitIdentity = [
  "-c",
  "user.name=gates",
  "-c",
  "user.email=gates@example.invalid",
  "-c",
  "commit.gpgsign=false",
];

function git(root: string, args: readonly string[]): string {
  const result = runCommand(["git", ...gitIdentity, ...args], { cwd: root });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(" ")} failed in the sandbox:\n${result.output}`);
  }
  return result.output;
}

function listRepoFiles(repo: string): readonly string[] {
  const listing = runCommand(["git", "ls-files", "-z", "-c", "-o", "--exclude-standard"], {
    cwd: repo,
  });
  if (listing.status !== 0) {
    throw new Error(`git ls-files failed:\n${listing.output}`);
  }
  return listing.output
    .split("\0")
    .filter((file) => file.trim().length > 0 && existsSync(join(repo, file)));
}

// pnpm refuses a linked node_modules, so the sandbox gets its own install from the store.
function install(root: string): void {
  const result = runCommand(["pnpm", "install", "--offline", "--frozen-lockfile"], { cwd: root });
  if (result.status !== 0) {
    throw new Error(`pnpm install failed in the sandbox:\n${result.output}`);
  }
}

/** Copies the repo's tracked and unignored files into a new sandbox with its own git history. */
export function createSandbox(repo: string): Sandbox {
  const root = mkdtempSync(join(tmpdir(), "binference-gates-"));
  for (const file of listRepoFiles(repo)) {
    const target = join(root, file);
    mkdirSync(dirname(target), { recursive: true });
    cpSync(join(repo, file), target);
  }
  install(root);
  git(root, ["init", "-q", "-b", "master"]);
  git(root, ["add", "-A"]);
  git(root, ["commit", "-q", "-m", "chore: start the sandbox"]);
  const base = git(root, ["rev-parse", "HEAD"]).trim();
  return {
    root,
    plant(files) {
      for (const [file, content] of Object.entries(files)) {
        const target = join(root, file);
        mkdirSync(dirname(target), { recursive: true });
        writeFileSync(target, content);
      }
    },
    commit(message) {
      git(root, ["add", "-A"]);
      git(root, ["commit", "-q", "--allow-empty", "-m", message]);
    },
    reset() {
      git(root, ["reset", "-q", "--hard", base]);
      git(root, ["clean", "-q", "-fdx", "-e", "/node_modules"]);
    },
    dispose() {
      rmSync(root, { recursive: true, force: true });
    },
  };
}
