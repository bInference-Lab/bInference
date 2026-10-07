import { createHash, randomUUID } from "node:crypto";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import process from "node:process";
import { listRepoFiles } from "../repo-files.mjs";
import { runCommand } from "../run-command.mjs";

/** A copy of the repo where gates run against planted violations. */
export interface Sandbox {
  readonly root: string;
  /** Writes files, paths relative to the sandbox root. */
  plant(files: Readonly<Record<string, string>>): void;
  /** Commits the current state, so later cases and git-based checks start from it. */
  commit(message: string): void;
  /** Drops every change and commit since the sandbox was brought up to date. */
  reset(): void;
  /** Resets the sandbox and keeps it for the next run. */
  release(): void;
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

function hasCode(error: unknown, code: string): boolean {
  return error instanceof Error && "code" in error && error.code === code;
}

// pnpm refuses a linked node_modules, so the sandbox gets its own install from the store.
function install(root: string): void {
  const result = runCommand(["pnpm", "install", "--prefer-offline", "--frozen-lockfile"], {
    cwd: root,
  });
  if (result.status !== 0) {
    throw new Error(`pnpm install failed in the sandbox:\n${result.output}`);
  }
}

// Copies the files that differ. Copies keep their times, so an unchanged file is skipped next run.
function copyFiles(repo: string, root: string, files: readonly string[]): void {
  for (const file of files) {
    const source = statSync(join(repo, file));
    const target = join(root, file);
    const kept = existsSync(target) ? statSync(target) : undefined;
    if (kept?.size === source.size && kept.mtimeMs === source.mtimeMs) {
      continue;
    }
    mkdirSync(dirname(target), { recursive: true });
    cpSync(join(repo, file), target, { preserveTimestamps: true });
  }
}

// Sandboxes outlive a run: making one and deleting it again touches some 40,000 node_modules
// entries, which took most of a shard's time when six shards did it at once. Each repo folder has
// its own pool in the system's temporary folder, outside every tool's reach; Turborepo passes the
// temporary folder's variables through (turbo.json), so every run finds the same pool.
function poolOf(repo: string): string {
  const key = createHash("sha256").update(repo).digest("hex").slice(0, 12);
  return join(tmpdir(), `binference-gates-${key}`);
}

function isRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return hasCode(error, "EPERM");
  }
}

// Renaming succeeds for exactly one process, so two shards never take the same folder.
function renameIfPresent(from: string, to: string): boolean {
  try {
    renameSync(from, to);
    return true;
  } catch (error) {
    if (hasCode(error, "ENOENT")) {
      return false;
    }
    throw error;
  }
}

// The commit a sandbox resets to, kept as a ref so a sandbox left by a dead run can be reset too.
const baseRef = "refs/gates/base";

function hasBase(root: string): boolean {
  return (
    existsSync(join(root, ".git")) &&
    runCommand(["git", "rev-parse", "--verify", "-q", baseRef], { cwd: root }).status === 0
  );
}

// A run that dies, such as one Turborepo stops when another task fails, leaves its sandbox busy.
// It goes back to the pool: the next run resets it to its base, and its install repairs
// node_modules. One that died before it had a base is deleted.
function reclaimAbandoned(pool: string): void {
  for (const name of readdirSync(pool)) {
    const match = /^busy-(\d+)-(.+)$/.exec(name);
    if (match === null || isRunning(Number(match[1]))) {
      continue;
    }
    const taken = join(pool, `trash-${randomUUID()}`);
    if (!renameIfPresent(join(pool, name), taken)) {
      continue;
    }
    if (hasBase(taken)) {
      renameSync(taken, join(pool, `idle-${match[2] ?? randomUUID()}`));
    } else {
      rmSync(taken, { recursive: true, force: true });
    }
  }
}

function claimIdle(pool: string, busy: string): boolean {
  return readdirSync(pool).some(
    (entry) => entry.startsWith("idle-") && renameIfPresent(join(pool, entry), busy),
  );
}

// Brings a kept sandbox from its base to the repo's files and commits them as the new base.
function refresh(repo: string, root: string, files: readonly string[]): void {
  const kept = git(root, ["ls-tree", "-r", "-z", "--name-only", baseRef])
    .split("\0")
    .filter((file) => file.length > 0);
  resetTo(root, baseRef, installsOf(kept));
  const wanted = new Set(files);
  for (const file of kept.filter((item) => !wanted.has(item))) {
    rmSync(join(root, file), { force: true });
  }
  copyFiles(repo, root, files);
  install(root);
  git(root, ["add", "-A"]);
  git(root, ["commit", "-q", "--allow-empty", "-m", "chore: bring the sandbox up to date"]);
  git(root, ["update-ref", baseRef, "HEAD"]);
}

function create(repo: string, root: string, files: readonly string[]): void {
  mkdirSync(root);
  copyFiles(repo, root, files);
  install(root);
  git(root, ["init", "-q", "-b", "master"]);
  git(root, ["add", "-A"]);
  git(root, ["commit", "-q", "-m", "chore: start the sandbox"]);
  git(root, ["update-ref", baseRef, "HEAD"]);
}

// Where the repo's own packages keep their installs, as git names an ignored folder.
function installsOf(files: readonly string[]): ReadonlySet<string> {
  return new Set(
    files.flatMap((file) =>
      file === "package.json" || file.endsWith("/package.json")
        ? [`${file.replace(/package\.json$/, "")}node_modules/`]
        : [],
    ),
  );
}

// Brings a sandbox back to `base`. git never walks into a node_modules folder: a deep one passes
// Windows' path limit, and pnpm links packages inside it. The repo's own packages keep their
// installs; Node deletes any other, such as a planted package's, before git cleans the rest. git
// names those folders without walking into them.
function resetTo(root: string, base: string, installs: ReadonlySet<string>): void {
  git(root, ["reset", "-q", "--hard", base]);
  const ignored = git(root, [
    "ls-files",
    "-z",
    "--others",
    "--ignored",
    "--exclude-standard",
    "--directory",
  ]).split("\0");
  for (const folder of ignored) {
    if (folder.endsWith("node_modules/") && !installs.has(folder)) {
      rmSync(join(root, folder), { recursive: true, force: true });
    }
  }
  git(root, ["clean", "-q", "-fdx", "-e", "node_modules"]);
}

/**
 * Takes an idle sandbox of the repo, or makes one, and brings it up to the repo's tracked and
 * unignored files with its own git history.
 */
export function openSandbox(repo: string): Sandbox {
  const pool = poolOf(repo);
  mkdirSync(pool, { recursive: true });
  reclaimAbandoned(pool);
  const id = randomUUID();
  const root = join(pool, `busy-${String(process.pid)}-${id}`);
  const repoFiles = listRepoFiles(repo);
  if (claimIdle(pool, root) && hasBase(root)) {
    refresh(repo, root, repoFiles);
  } else {
    rmSync(root, { recursive: true, force: true });
    create(repo, root, repoFiles);
  }
  const base = git(root, ["rev-parse", baseRef]).trim();
  const installs = installsOf(repoFiles);
  const reset = (): void => {
    resetTo(root, base, installs);
  };
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
    reset,
    release() {
      try {
        reset();
        renameSync(root, join(pool, `idle-${id}`));
      } catch (error) {
        rmSync(root, { recursive: true, force: true });
        throw error;
      }
    },
  };
}
