/** The release notes' own words in one language: the group headings and the range line. */
export interface NotesWords {
  readonly breaking: string;
  readonly feat: string;
  readonly fix: string;
  readonly perf: string;
  readonly other: string;
  readonly first: (count: string) => string;
  readonly since: (count: string, since: string) => string;
}

/** The release notes' own words in English. */
export const notesWordsEn: NotesWords = {
  breaking: "Breaking changes",
  feat: "New",
  fix: "Fixes",
  perf: "Faster",
  other: "Other changes",
  first: (count) => `The first release, from ${count} commits.`,
  since: (count, since) => `${count} changes since ${since}.`,
};
