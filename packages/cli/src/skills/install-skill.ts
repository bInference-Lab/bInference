import { dirname, join } from "node:path";
import type { Clock, Random } from "@binference/core";
import {
  ensurePrivateFolder,
  type FilePermissions,
  movePath,
  removePath,
  writePrivateFile,
} from "@binference/platform";
import { lintSkill } from "@binference/plugin-sdk";
import {
  type FetchRefusal,
  fetchGitSkill,
  fetchNpmSkill,
  type NpmPack,
  skillLimits,
} from "./fetch-skill.js";
import { readInstalledSkills, writeInstalledSkills } from "./installed-skills.js";
import { readSkillFile } from "./skill-file.js";
import type { SkillShelf } from "./skill-shelf.js";
import type { SkillSource } from "./skill-source.js";
import type { PackedFile } from "./tar-files.js";

/** What an install reads and writes. */
export interface InstallParts {
  /** The state folder's `skills/`, and a folder beside it on the same disk for work under way. */
  readonly folders: { readonly installed: string; readonly staging: string };
  /** Names the bundled skills, which no install may take. */
  readonly shelf: Pick<SkillShelf, "bundledNames">;
  readonly permissions: FilePermissions;
  readonly clock: Clock;
  readonly random: Random;
  /** `npm pack` unless a test passes another packer. */
  readonly pack?: NpmPack;
}

/** One lint finding of a refused skill: the file, the line and the code, never the text. */
interface InstallFinding {
  readonly file: string;
  readonly line: number;
  readonly code: string;
}

/** A failure of an install that names no finding. */
type PlainFailureCode =
  | "skill.hash_mismatch"
  | "skill.invalid"
  | "skill.name_taken"
  | "skill.fetch_failed";

/** Why an install changed nothing. */
export type InstallFailure =
  | { readonly code: PlainFailureCode }
  | { readonly code: "skill.refused"; readonly findings: readonly InstallFinding[] };

/** How a step of the install went: its value, or the failure that ends the install. */
type Step<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly failure: InstallFailure };

/** How an install ended: the skill it put in place, or why it changed nothing. */
export type InstallOutcome = Step<InstalledView>;

function failed(failure: InstallFailure): { readonly ok: false; readonly failure: InstallFailure } {
  return { ok: false, failure };
}

/** A skill as the install put it in place. */
export interface InstalledView {
  readonly name: string;
  readonly description: string;
  readonly source: string;
  readonly hash: string;
  readonly installedAt: number;
}

/** What `skill/add` asks for: the source as given, read, and the hash it pins. */
export interface InstallRequest {
  readonly source: string;
  readonly hash: string;
  readonly from: SkillSource;
}

// A refusal names at most this many findings.
const maxFindings = 20;
const fetchCodes: Readonly<Record<FetchRefusal, PlainFailureCode>> = {
  fetch_failed: "skill.fetch_failed",
  hash_mismatch: "skill.hash_mismatch",
  too_large: "skill.invalid",
};

/** The text of a file, or `undefined` for one that is not UTF-8 text. */
function textOf(bytes: Uint8Array): string | undefined {
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return text.includes("\u0000") ? undefined : text;
  } catch {
    return undefined;
  }
}

function findingsOf(files: readonly PackedFile[]): readonly InstallFinding[] {
  return files
    .flatMap((file) => {
      const text = textOf(file.bytes);
      return text === undefined
        ? []
        : lintSkill(text).map(({ line, code }) => ({ file: file.path, line, code }));
    })
    .slice(0, maxFindings);
}

/** Checks the fetched files and answers the skill's name and description, or why it is refused. */
async function checked(
  parts: InstallParts,
  files: readonly PackedFile[],
  signal: AbortSignal,
): Promise<Step<{ readonly name: string; readonly description: string }>> {
  const size = files.reduce((total, file) => total + file.bytes.byteLength, 0);
  const skillMd = files.find((file) => file.path === "SKILL.md");
  const text = skillMd === undefined ? undefined : textOf(skillMd.bytes);
  const front = text === undefined ? undefined : readSkillFile(text);
  if (front?.ok !== true || files.length > skillLimits.files || size > skillLimits.bytes) {
    return failed({ code: "skill.invalid" });
  }
  if ((await parts.shelf.bundledNames(signal)).has(front.value.name)) {
    return failed({ code: "skill.name_taken" });
  }
  const findings = findingsOf(files);
  if (findings.length > 0) {
    return failed({ code: "skill.refused", findings });
  }
  return { ok: true, value: { name: front.value.name, description: front.value.description } };
}

async function fetched(
  parts: InstallParts,
  from: SkillSource,
  place: { readonly work: string; readonly signal: AbortSignal },
): Promise<Step<readonly PackedFile[]>> {
  const at = { ...place, permissions: parts.permissions };
  const files =
    from.kind === "git"
      ? await fetchGitSkill(from, at)
      : await fetchNpmSkill(from, parts.pack === undefined ? at : { ...at, pack: parts.pack });
  return files.ok ? files : failed({ code: fetchCodes[files.error] });
}

async function writeFiles(
  folder: string,
  files: readonly PackedFile[],
  options: { readonly permissions: FilePermissions; readonly signal: AbortSignal },
): Promise<void> {
  for (const file of files) {
    const path = join(folder, file.path);
    // oxlint-disable-next-line eslint/no-await-in-loop -- one file after another keeps the order of the writes
    await ensurePrivateFolder(dirname(path), options);
    // oxlint-disable-next-line eslint/no-await-in-loop -- as above
    await writePrivateFile(path, file.bytes, options);
  }
}

// Writes the skill beside the installed ones, then moves it in place of one of the same name.
async function putInPlace(
  parts: InstallParts,
  skill: { readonly name: string; readonly files: readonly PackedFile[]; readonly work: string },
  signal: AbortSignal,
): Promise<void> {
  const options = { permissions: parts.permissions, signal };
  const ready = join(skill.work, "skill");
  await writeFiles(ready, skill.files, options);
  await ensurePrivateFolder(parts.folders.installed, options);
  const target = join(parts.folders.installed, skill.name);
  await movePath(target, join(skill.work, "replaced"), signal);
  await movePath(ready, target, signal);
}

/**
 * Installs a skill from git or npm at its pinned hash (decision 0207): fetches it into a folder of
 * its own beside `skills/`, checks it (a `SKILL.md` whose frontmatter reads, at most 200 files and
 * 2 MiB, a name no bundled skill has, and no lint finding in any text file), then moves it in place
 * of an installed skill of that name and records its source, hash and time. Any failure changes
 * nothing; the work folder is removed either way.
 */
export async function installSkill(
  parts: InstallParts,
  request: InstallRequest,
  signal: AbortSignal,
): Promise<InstallOutcome> {
  const hex = Buffer.from(parts.random.bytes(8)).toString("hex");
  const work = join(parts.folders.staging, `skill-${hex}`);
  await ensurePrivateFolder(work, { permissions: parts.permissions, signal });
  try {
    const files = await fetched(parts, request.from, { work, signal });
    if (!files.ok) {
      return files;
    }
    const skill = await checked(parts, files.value, signal);
    if (!skill.ok) {
      return skill;
    }
    const { name, description } = skill.value;
    await putInPlace(parts, { name, files: files.value, work }, signal);
    const installedAt = parts.clock.now();
    const record = new Map(await readInstalledSkills(parts.folders.installed, signal));
    record.set(name, { source: request.source, hash: request.hash, installedAt });
    const options = { permissions: parts.permissions, signal };
    await writeInstalledSkills(parts.folders.installed, record, options);
    const view = { name, description, source: request.source, hash: request.hash, installedAt };
    return { ok: true, value: view };
  } finally {
    // The work folder goes even when the install was stopped.
    await removePath(work, AbortSignal.timeout(30_000));
  }
}
