import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { createPlatform } from "@binference/platform";
import { z } from "zod";
import {
  installPackedSkill,
  type PackedSkillPlace,
} from "../../packages/cli/src/packed/install-packed-skill.js";
import {
  skillPackage,
  type SkillPackage,
  skillPackageName,
  skillPackageShared,
} from "../../packages/cli/src/packed/skill-packages.js";
import { createSystemClock } from "../../packages/cli/src/runtime/system-clock.js";
import { createSystemRandom } from "../../packages/cli/src/runtime/system-random.js";
import { runCommand } from "../run-command.mjs";
import { type PackedFile, sha256Of } from "./pack-release.mjs";

const agentAudience = /^\s+binference-audience: agent$/m;

// The bundled skills for the agent, by folder. A skill for MCP clients alone, binference-tools,
// ships inside binference, which `binference mcp setup` installs it from.
function agentSkills(root: string): readonly string[] {
  const folder = join(root, "skills");
  return readdirSync(folder)
    .filter((name) => existsSync(join(folder, name, "SKILL.md")))
    .filter((name) => agentAudience.test(readFileSync(join(folder, name, "SKILL.md"), "utf8")))
    .toSorted();
}

/** The npm name of each bundled skill's package (decision 0457), in folder order. */
export function skillPackageNames(root: string): readonly string[] {
  return agentSkills(root).map((skill) => skillPackageName(skill));
}

/** The version a dry run packs at, and whether it is a nightly that nothing publishes. */
interface SkillRelease {
  readonly version: string;
  readonly isNightly: boolean;
}

const manifestSchema = z.looseObject({ repository: z.looseObject({ url: z.string() }) });

function packagesOf(root: string, release: SkillRelease): readonly SkillPackage[] {
  const cli = manifestSchema.parse(
    JSON.parse(readFileSync(join(root, "packages", "cli", "package.json"), "utf8")),
  );
  const template = join(root, "config", "release", "skill-package");
  const readmes = {
    en: readFileSync(join(template, "README.md"), "utf8"),
    zh: readFileSync(join(template, "README.zh.md"), "utf8"),
  };
  return agentSkills(root).map((skill) =>
    skillPackage({
      skill,
      text: readFileSync(join(root, "skills", skill, "SKILL.md"), "utf8"),
      ...release,
      readmes,
      repository: cli.repository.url,
    }),
  );
}

const packOutputSchema = z.array(
  z.looseObject({ filename: z.string(), files: z.array(z.looseObject({ path: z.string() })) }),
);

function stage(root: string, packed: SkillPackage, staged: string): void {
  for (const [path, text] of packed.files) {
    mkdirSync(dirname(join(staged, path)), { recursive: true });
    writeFileSync(join(staged, path), text);
  }
  for (const file of skillPackageShared) {
    cpSync(join(root, file), join(staged, file));
  }
}

// A skill package holds its manifest, its skill folders, its npm page and the notices, and no
// code: any other file stops the pack.
function packStaged(root: string, packed: SkillPackage, out: string): PackedFile {
  const staged = join(out, "stage", packed.name);
  stage(root, packed, staged);
  const result = runCommand(
    ["npm", "pack", "--json", "--ignore-scripts", "--loglevel=error", "--pack-destination", out],
    { cwd: staged },
  );
  const made =
    result.status === 0 ? packOutputSchema.parse(JSON.parse(result.output)).at(0) : undefined;
  if (made === undefined) {
    throw new Error(`npm pack failed for ${packed.name}:\n${result.output}`);
  }
  const expected = [...packed.files.keys(), ...skillPackageShared].toSorted();
  const held = made.files.map((entry) => entry.path).toSorted();
  if (held.join("\n") !== expected.join("\n")) {
    throw new Error(`${made.filename} holds ${held.join(", ")}, not ${expected.join(", ")}.`);
  }
  const file = join(out, made.filename);
  const bytes = statSync(file).size;
  return { name: packed.name, file: made.filename, bytes, sha256: sha256Of(file), bundled: [] };
}

/**
 * Stages and packs one npm package per bundled skill of the agent into `out` (decision 0457), at
 * the release's version, private for a nightly. Throws, naming the package, when a skill does not
 * read or npm packs a file the package should not hold.
 */
export function packSkillPackages(
  root: string,
  release: SkillRelease,
  out: string,
): readonly PackedFile[] {
  return packagesOf(root, release).map((packed) => packStaged(root, packed, out));
}

// The skill folders a staged package holds: `agent`, and `mcp` when the skill has a copy for MCP
// clients.
function foldersOf(out: string, packed: PackedFile): readonly ("agent" | "mcp")[] {
  return existsSync(join(out, "stage", packed.name, "mcp")) ? ["agent", "mcp"] : ["agent"];
}

/** The packed skill packages a check installs, at their version. */
interface PackedSkills {
  readonly version: string;
  readonly files: readonly PackedFile[];
}

async function installEach(out: string, packed: PackedSkills, place: PackedSkillPlace) {
  const signal = AbortSignal.timeout(120_000);
  const asks = packed.files.flatMap((file) =>
    foldersOf(out, file).map((folder) => ({ file, folder })),
  );
  for (const { file, folder } of asks) {
    const request = {
      name: file.name,
      version: packed.version,
      tarball: join(out, file.file),
      folder,
    };
    const into = { ...place, work: join(place.work, file.name, folder) };
    // oxlint-disable-next-line eslint/no-await-in-loop -- one install after another, each in its own folder
    const outcome = await installPackedSkill(request, into, signal);
    if (!outcome.ok) {
      const failure = JSON.stringify(outcome.failure);
      throw new Error(`${file.file}#${folder} does not install through skill/add: ${failure}.`);
    }
  }
}

/**
 * Installs each skill folder of each packed skill package as `skill/add` would from npm, pinned
 * by the tarball's SHA-512, into an empty folder of its own, so the install lint runs on every
 * file. Throws, naming the tarball, the folder and the failure.
 */
export async function checkSkillInstalls(out: string, packed: PackedSkills): Promise<void> {
  const work = mkdtempSync(join(tmpdir(), "binference-skills-"));
  try {
    await installEach(out, packed, {
      work,
      permissions: createPlatform({ binferenceHome: work, homeDir: work }).permissions,
      clock: createSystemClock(),
      random: createSystemRandom(),
    });
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}
