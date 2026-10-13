import { createHash } from "node:crypto";
import { join } from "node:path";
import { err, type Id, type Logger, ok, type Result } from "@binference/core";
import { listFolderFiles, readTextFile } from "@binference/platform";
import { lintSkill } from "@binference/plugin-sdk";
import { type InstalledSkills, readInstalledSkills } from "./installed-skills.js";
import { readSkillFile } from "./skill-file.js";

/** Where a skill lives (decision 0207). */
type SkillPlace = "bundled" | "installed" | "workspace";

/** One skill an agent's index holds, or one installed for every agent. */
export interface ShelfSkill {
  /** Its name when installed, else `bundled:<name>` or `workspace:<name>`. */
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly place: SkillPlace;
  /** `<place>/<name>/SKILL.md`, what the agent's index names it by. */
  readonly location: string;
  /** Its folder on this machine; never shown to the agent. */
  readonly folder: string;
  readonly source: string;
  readonly hash: string;
  readonly installedAt: number;
  /** The agent whose workspace holds it. */
  readonly agent?: Id<"agt">;
}

/** Where the skills are. */
interface SkillFolders {
  /** The folders the package's own `skills/` may be in; the first that holds a skill is used. */
  readonly bundled: readonly string[];
  /** The state folder's `skills/`. */
  readonly installed: string;
  /** The state folder's `workspace/`, one folder per agent. */
  readonly workspace: string;
}

/** What the shelf reads. */
export interface SkillShelfOptions {
  readonly folders: SkillFolders;
  /** When this engine started: when a bundled or workspace skill counts as installed. */
  readonly startedAtMs: number;
  readonly logger: Logger;
}

/** One skill folder found in a place, before its `SKILL.md` is read. */
interface Found {
  readonly place: SkillPlace;
  readonly folderName: string;
  readonly folder: string;
  readonly agent?: Id<"agt">;
}

// A skill is a folder of its own, its name not starting with a dot, holding `SKILL.md`.
const skillMdPath = /^([^/.][^/]*)\/SKILL\.md$/;

/** The SHA-256 of a text, in hex. */
function sha256Text(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

async function foldersIn(
  root: string,
  where: Pick<Found, "place" | "agent">,
  signal: AbortSignal,
): Promise<readonly Found[]> {
  const files = await listFolderFiles(root, signal);
  return files.flatMap((file) => {
    const folderName = skillMdPath.exec(file)?.[1];
    return folderName === undefined
      ? []
      : [{ ...where, folderName, folder: join(root, folderName) }];
  });
}

async function bundledFolders(roots: readonly string[], signal: AbortSignal) {
  for (const root of roots) {
    // oxlint-disable-next-line eslint/no-await-in-loop -- the first root that holds a skill wins
    const found = await foldersIn(root, { place: "bundled" }, signal);
    if (found.length > 0) {
      return found;
    }
  }
  return [];
}

/** What a found skill becomes once its `SKILL.md` is read, or why it is left out. */
type Read = Result<ShelfSkill, string>;

function provenance(
  found: Found,
  context: {
    readonly installed: InstalledSkills;
    readonly startedAtMs: number;
    readonly text: string;
  },
): Pick<ShelfSkill, "source" | "hash" | "installedAt"> | undefined {
  if (found.place !== "installed") {
    return {
      source: found.place,
      hash: sha256Text(context.text),
      installedAt: context.startedAtMs,
    };
  }
  return context.installed.get(found.folderName);
}

async function readFound(
  found: Found,
  context: { readonly installed: InstalledSkills; readonly startedAtMs: number },
  signal: AbortSignal,
): Promise<Read> {
  const read = await readTextFile(join(found.folder, "SKILL.md"), signal);
  if (!read.ok) {
    return err("skill.not_found");
  }
  const front = readSkillFile(read.value);
  if (!front.ok || front.value.name !== found.folderName) {
    return err("skill.invalid");
  }
  if (lintSkill(read.value).length > 0) {
    return err("skill.refused");
  }
  const from = provenance(found, { ...context, text: read.value });
  if (from === undefined || front.value.audience === "mcp") {
    return err(from === undefined ? "skill.not_found" : "skill.mcp_only");
  }
  const { name, description } = front.value;
  const id = found.place === "installed" ? name : `${found.place}:${name}`;
  const location = `${found.place}/${name}/SKILL.md`;
  const agent = found.agent === undefined ? {} : { agent: found.agent };
  return ok({
    id,
    name,
    description,
    place: found.place,
    location,
    folder: found.folder,
    ...from,
    ...agent,
  });
}

/** The skills of an install, read from their folders each time they are asked for. */
export interface SkillShelf {
  /**
   * With an agent, the skills its index holds: its workspace skills, then the bundled and the
   * installed ones it does not shadow, by name. Without, the bundled and installed skills.
   */
  list(agent: Id<"agt"> | undefined, signal: AbortSignal): Promise<readonly ShelfSkill[]>;
  /** The names of the bundled skills' folders, every one of them, which no install may take. */
  bundledNames(signal: AbortSignal): Promise<ReadonlySet<string>>;
}

// The places in the order a name wins: the owner's own, then binference's, then installed.
const rank: Readonly<Record<SkillPlace, number>> = { workspace: 0, bundled: 1, installed: 2 };

function byName(skills: readonly ShelfSkill[]): readonly ShelfSkill[] {
  const kept = new Map<string, ShelfSkill>();
  for (const skill of skills.toSorted((one, two) => rank[one.place] - rank[two.place])) {
    if (!kept.has(skill.name)) {
      kept.set(skill.name, skill);
    }
  }
  return [...kept.values()].toSorted((one, two) => (one.name < two.name ? -1 : 1));
}

/**
 * Creates the {@link SkillShelf} over the bundled, installed and workspace folders (decision
 * 0207). A skill whose `SKILL.md` is missing, fails its frontmatter, names another folder, has a
 * lint finding, is for MCP clients alone, or is installed without a record, is left out; each is
 * logged once by its location.
 */
export function createSkillShelf(options: SkillShelfOptions): SkillShelf {
  const { folders, startedAtMs, logger } = options;
  const logged = new Set<string>();
  const leaveOut = (found: Found, code: string): void => {
    const sourceId = `${found.place}/${found.folderName}/SKILL.md`;
    if (code !== "skill.mcp_only" && !logged.has(`${sourceId} ${code}`)) {
      logged.add(`${sourceId} ${code}`);
      logger.warn("skill.left_out", { sourceId, errorCode: code, ...agentField(found) });
    }
  };
  return {
    async list(agent, signal) {
      const workspace =
        agent === undefined
          ? []
          : await foldersIn(
              join(folders.workspace, agent, "skills"),
              { place: "workspace", agent },
              signal,
            );
      const found = [
        ...workspace,
        ...(await bundledFolders(folders.bundled, signal)),
        ...(await foldersIn(folders.installed, { place: "installed" }, signal)),
      ];
      const installed = await readInstalledSkills(folders.installed, signal);
      const read = await Promise.all(
        found.map(async (each) => ({
          each,
          read: await readFound(each, { installed, startedAtMs }, signal),
        })),
      );
      const skills = read.flatMap(({ each, read: result }) => {
        if (!result.ok) {
          leaveOut(each, result.error);
          return [];
        }
        return [result.value];
      });
      return byName(skills);
    },
    async bundledNames(signal) {
      const found = await bundledFolders(folders.bundled, signal);
      return new Set(found.map(({ folderName }) => folderName));
    },
  };
}

function agentField(found: Found): { readonly agentId?: string } {
  return found.agent === undefined ? {} : { agentId: found.agent };
}
