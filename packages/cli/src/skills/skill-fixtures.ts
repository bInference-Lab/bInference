import { dirname, join } from "node:path";
import { BinferenceError } from "@binference/core";
import { ensurePrivateFolder, runCommandWithin, writePrivateFile } from "@binference/platform";
import { noPermissions } from "../e2e/test-host.js";

// Test fixtures for the skills: skill files, a git repository at one commit, an npm package.

/** What a test skill says besides its name. */
export interface SkillTextOptions {
  readonly description?: string;
  readonly body?: string;
  readonly metadata?: Readonly<Record<string, string>>;
}

/** A `SKILL.md` of a test skill: its frontmatter, then its body. */
export function skillText(name: string, extra: SkillTextOptions = {}): string {
  const metadata = Object.entries(extra.metadata ?? {}).map(([key, value]) => `  ${key}: ${value}`);
  const front = [
    `name: ${name}`,
    `description: ${extra.description ?? `Helps with ${name}.`}`,
    ...(metadata.length === 0 ? [] : ["metadata:", ...metadata]),
  ];
  const body = extra.body ?? `# ${name}\n\nCheck the token first.`;
  return ["---", ...front, "---", "", body, ""].join("\n");
}

/** Writes files under a folder, by their paths inside it. */
export async function writeFiles(
  folder: string,
  files: Readonly<Record<string, string>>,
): Promise<void> {
  const options = { permissions: noPermissions, signal: AbortSignal.timeout(30_000) };
  for (const [path, text] of Object.entries(files)) {
    const target = join(folder, path);
    // oxlint-disable-next-line eslint/no-await-in-loop -- a test's few files, in order
    await ensurePrivateFolder(dirname(target), options);
    // oxlint-disable-next-line eslint/no-await-in-loop -- as above
    await writePrivateFile(target, text, options);
  }
}

async function run(file: string, args: readonly string[]): Promise<string> {
  const signal = AbortSignal.timeout(30_000);
  const exit = await runCommandWithin(file, args, { signal, timeoutMs: 30_000 });
  if (exit.exitCode !== 0) {
    throw new BinferenceError({ code: "test.command_failed", message: exit.stderr });
  }
  return exit.stdout.trim();
}

async function git(folder: string, args: readonly string[]): Promise<string> {
  const identity = ["-c", "user.name=test", "-c", "user.email=test@example.com"];
  return run("git", ["-C", folder, ...identity, ...args]);
}

/** Makes a git repository of the files in one commit and answers its commit id. */
export async function commitRepository(
  folder: string,
  files: Readonly<Record<string, string>>,
): Promise<string> {
  await writeFiles(folder, files);
  await git(folder, ["init", "--quiet"]);
  await git(folder, ["add", "--all"]);
  await git(folder, ["commit", "--quiet", "--message", "skill"]);
  return git(folder, ["rev-parse", "HEAD"]);
}

/** Packs a folder with `npm pack` into another, as the registry would serve the package. */
export async function packFolder(folder: string, destination: string): Promise<void> {
  await run("npm", [
    "pack",
    folder,
    "--pack-destination",
    destination,
    "--ignore-scripts",
    "--silent",
  ]);
}
