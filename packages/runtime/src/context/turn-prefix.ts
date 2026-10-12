import type { Id } from "@binference/core";
import { type WorkspaceFile, workspaceFiles } from "@binference/protocol";
import type { ContextSource } from "../relay/ports.js";

/** The most characters of one workspace file the prefix holds (runtime spec, section 7.2). */
export const fileMaxChars = 12_000;
/** The most characters of all the workspace files together. */
export const workspaceMaxChars = 40_000;

/** One workspace file the agent has, with its text. */
export interface WorkspaceText {
  readonly file: WorkspaceFile;
  readonly text: string;
}

const workspaceHeading =
  "# Workspace files\n\nThe owner's files for this agent, in the owner's words.";

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

/**
 * The stable prefix as text (runtime spec, section 7.1): the instructions, then each workspace
 * file the agent has in the order given, inside a delimiter that names it. A file is cut at 12,000
 * characters and all of them at 40,000, each cut with a line that says so; a file past the total
 * is left out with a line naming it. The same instructions and files always give the same bytes.
 */
export function prefixText(instructions: string, files: readonly WorkspaceText[]): string {
  if (files.length === 0) {
    return instructions;
  }
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
  return [instructions, workspaceHeading, ...sections].join("\n\n");
}

/**
 * Reads the agent's workspace files from the engine, in the order a turn reads them, and gives
 * the turn's stable prefix. A file the agent does not have is left out. Rejects when the engine
 * cannot answer, and with the signal's reason once it aborts.
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
  return prefixText(turn.instructions, read.flat());
}
