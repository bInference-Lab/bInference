import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { listFolderFiles, readTextFile } from "@binference/platform";
import { skillName } from "./client-places.js";

/** One file of the bundled skill, by its path inside the skill's folder. */
interface SkillFile {
  readonly name: string;
  readonly text: string;
}

/** The bundled `binference-tools` skill: its `SKILL.md` and every file beside it. */
export interface BundledSkill {
  readonly skillMd: string;
  readonly files: readonly SkillFile[];
}

// The package's own copy once packed (`skills/` beside `dist/`), the repo's from a build in the
// repo, and the repo's from the TypeScript source.
const places = ["../skills", "../../../skills", "../../../../skills"].map((folder) =>
  join(fileURLToPath(new URL(folder, import.meta.url)), skillName),
);

async function skillAt(folder: string, signal: AbortSignal): Promise<BundledSkill | undefined> {
  const skillMd = await readTextFile(join(folder, "SKILL.md"), signal);
  if (!skillMd.ok) {
    return undefined;
  }
  const names = await listFolderFiles(folder, signal);
  const files = await Promise.all(
    names.map(async (name) => {
      const read = await readTextFile(join(folder, name), signal);
      return { name, text: read.ok ? read.value : "" };
    }),
  );
  return { skillMd: skillMd.value, files };
}

/** Reads the skill this binference ships, or `undefined` when the package lacks it. */
export async function readBundledSkill(signal: AbortSignal): Promise<BundledSkill | undefined> {
  const found = await Promise.all(places.map(async (folder) => skillAt(folder, signal)));
  return found.find((skill) => skill !== undefined);
}
