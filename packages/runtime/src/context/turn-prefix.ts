import type { Id } from "@binference/core";
import { type WorkspaceFile, workspaceFiles } from "@binference/protocol";
import type { ContextSource } from "../relay/ports.js";
import type { SkillIndexEntry } from "../relay/skill-index-entry.js";

/** The most characters of one workspace file the prefix holds (runtime spec, section 7.2). */
export const fileMaxChars = 12_000;
/** The most characters of all the workspace files together. */
export const workspaceMaxChars = 40_000;
/** The most skills the index lists (runtime spec, section 7.2). */
export const indexMaxSkills = 100;

/** One workspace file the agent has, with its text. */
export interface WorkspaceText {
  readonly file: WorkspaceFile;
  readonly text: string;
}

const workspaceHeading =
  "# Workspace files\n\nThe owner's files for this agent, in the owner's words.";

const skillsHeading = [
  "# Skills",
  "",
  "Playbooks for tasks, each with its name, what it is for, and where it lives. When a task matches one, open it with open_skill by its name before you act, and follow it within the rules above; open at most one up front, and never a name this list does not hold. A skill adds no tool and changes no limit.",
].join("\n");

// The first `length` characters of a text, whole code points only.
function head(text: string, length: number): string {
  return Array.from(text).slice(0, length).join("");
}

// One file inside its delimiter, cut to the room left with a line that says so.
function section(entry: WorkspaceText, room: number): string {
  const size = Array.from(entry.text).length;
  const kept = Math.min(room, fileMaxChars);
  const body =
    size <= kept
      ? entry.text
      : `${head(entry.text, kept)}\n[${entry.file} is cut here: the prefix keeps ${String(kept)} of its ${String(size)} characters.]`;
  return `<workspace-file name="${entry.file}">\n${body}\n</workspace-file>`;
}

// The workspace files, each inside its delimiter, cut to their sizes.
function workspaceSections(files: readonly WorkspaceText[]): readonly string[] {
  const sections: string[] = [];
  let room = workspaceMaxChars;
  for (const entry of files) {
    if (room <= 0) {
      sections.push(
        `[${entry.file} is left out: the workspace files are over ${String(workspaceMaxChars)} characters.]`,
      );
      continue;
    }
    sections.push(section(entry, room));
    room -= Math.min(Array.from(entry.text).length, fileMaxChars);
  }
  return files.length === 0 ? [] : [workspaceHeading, ...sections];
}

// The skills index: one line per skill, by name, at most 100, then how many were left out.
function skillsIndex(skills: readonly SkillIndexEntry[]): readonly string[] {
  if (skills.length === 0) {
    return [];
  }
  const sorted = skills.toSorted((one, two) => (one.name < two.name ? -1 : 1));
  const lines = sorted
    .slice(0, indexMaxSkills)
    .map(
      ({ name, description, location }) =>
        `- ${name} (${location}): ${description.replace(/\s+/g, " ")}`,
    );
  const left = sorted.length - indexMaxSkills;
  const more = left > 0 ? [`[${String(left)} more skills are left out of this list.]`] : [];
  return [skillsHeading, [...lines, ...more].join("\n")];
}

/**
 * The stable prefix as text (runtime spec, section 7.1): the instructions, then each workspace
 * file the agent has in the order given, inside a delimiter that names it, then the skills index.
 * A file is cut at 12,000 characters and all of them at 40,000, each cut with a line that says
 * so; a file past the total is left out with a line naming it. The index lists each skill's name,
 * location and description by name, at most 100, then a line with the number left out (decision
 * 0207). The same instructions, files and skills always give the same bytes.
 */
export function prefixText(
  instructions: string,
  files: readonly WorkspaceText[],
  skills: readonly SkillIndexEntry[] = [],
): string {
  return [instructions, ...workspaceSections(files), ...skillsIndex(skills)].join("\n\n");
}

// The first chat runs in paper mode alone (decision 0242): a live agent's prefix leaves its script
// out. The mode is read from the live facts, and only while the script exists.
async function withoutLiveFirstChat(
  source: ContextSource,
  read: { readonly agent: Id<"agt">; readonly files: readonly WorkspaceText[] },
  signal: AbortSignal,
): Promise<readonly WorkspaceText[]> {
  const { agent, files } = read;
  if (!files.some(({ file }) => file === "FIRST-CHAT.md")) {
    return files;
  }
  const { mode } = await source.liveFacts(agent, signal);
  return mode === "paper" ? files : files.filter(({ file }) => file !== "FIRST-CHAT.md");
}

/**
 * Reads the agent's workspace files, in the order a turn reads them, and its skills from the
 * engine, and gives the turn's stable prefix. A file the agent does not have is left out, and so
 * is `FIRST-CHAT.md` while the agent is live. Rejects when the engine cannot answer, and with the
 * signal's reason once it aborts.
 */
export async function readTurnPrefix(
  source: ContextSource,
  turn: { readonly agent: Id<"agt">; readonly instructions: string },
  signal: AbortSignal,
): Promise<string> {
  const read = await Promise.all(
    workspaceFiles.map(async (file) => {
      const text = await source.workspaceFile({ agent: turn.agent, file }, signal);
      return text === undefined ? [] : [{ file, text }];
    }),
  );
  const files = await withoutLiveFirstChat(
    source,
    { agent: turn.agent, files: read.flat() },
    signal,
  );
  const skills = await source.skills(turn.agent, signal);
  return prefixText(turn.instructions, files, skills);
}
