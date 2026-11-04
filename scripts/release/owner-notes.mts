import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { type ReleaseNotes, releaseNotesSchema } from "@binference/protocol";
import { z } from "zod";
import { createTextScanner } from "../style/scan-text.mjs";
import { loadWordLists } from "../style/word-lists.mjs";

const languages = ["en", "zh"] as const;

/** The two files of a release's notes for owners, relative to the repository (decision 0355). */
function ownerNotesFiles(version: string): { readonly en: string; readonly zh: string } {
  return { en: `release/notes/${version}.en.json`, zh: `release/notes/${version}.zh.json` };
}

/** A release's notes for owners, or every problem that kept them from being read. */
export type OwnerNotes =
  | { readonly ok: true; readonly notes: ReleaseNotes }
  | { readonly ok: false; readonly problems: readonly string[] };

const linesSchema = z.array(z.string()).min(1);

// One language's file: its lines, or why it cannot be read.
function readLines(root: string, file: string): readonly string[] | string {
  const path = join(root, file);
  if (!existsSync(path)) {
    return `${file} is missing; write the release's notes for owners in it first.`;
  }
  try {
    const parsed = linesSchema.safeParse(JSON.parse(readFileSync(path, "utf8")));
    return parsed.success ? parsed.data : `${file} must be a JSON list of at least one line.`;
  } catch {
    return `${file} is not JSON.`;
  }
}

// The style guard over each line, in the file it came from, so Chinese passes only in the zh one.
function styleProblems(root: string, files: Readonly<Record<string, string>>, notes: ReleaseNotes) {
  const scan = createTextScanner(loadWordLists(root));
  return languages.flatMap((language) =>
    scan(files[language] ?? language, notes[language].join("\n")).map(
      (item) =>
        `${item.where}: line ${String(item.line)}: check:style(${item.rule}): ${item.message}`,
    ),
  );
}

/**
 * Reads a stable or beta release's notes for owners from `release/notes/<version>.en.json` and
 * `.zh.json` (decision 0355): each a JSON list of 1 to 5 lines of 1 to 200 characters that the
 * style guard passes. Answers the notes, or every problem found, one line each.
 */
export function readOwnerNotes(root: string, version: string): OwnerNotes {
  const files = ownerNotesFiles(version);
  const en = readLines(root, files.en);
  const zh = readLines(root, files.zh);
  const unread = [en, zh].filter((read) => typeof read === "string");
  if (unread.length > 0) {
    return { ok: false, problems: unread };
  }
  const parsed = releaseNotesSchema.safeParse({ en, zh });
  if (!parsed.success) {
    const bounds = `${files.en} and ${files.zh} hold at most 5 lines each, of 1 to 200 characters.`;
    return { ok: false, problems: [bounds] };
  }
  const problems = styleProblems(root, files, parsed.data);
  return problems.length === 0 ? { ok: true, notes: parsed.data } : { ok: false, problems };
}
