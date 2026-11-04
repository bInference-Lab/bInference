import { z } from "zod";

/**
 * A release's notes for owners in both languages (spec 4, section 4.2): what changed for them,
 * never commit subjects. Each list holds at most 5 lines of 1 to 200 characters; a language a
 * release has no notes in is an empty list.
 */
export interface ReleaseNotes {
  readonly en: readonly string[];
  readonly zh: readonly string[];
}

/** The most lines a release's notes hold in one language. */
const releaseNoteLines = 5;

/** The most characters one line of a release's notes holds. */
const releaseNoteChars = 200;

const lines = z.array(z.string().min(1).max(releaseNoteChars)).max(releaseNoteLines);

/** Parses a release's notes in both languages, within spec 4's bounds. */
export const releaseNotesSchema: z.ZodType<ReleaseNotes> = z.object({ en: lines, zh: lines });
