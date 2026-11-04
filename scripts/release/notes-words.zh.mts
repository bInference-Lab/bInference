import type { NotesWords } from "./notes-words.mjs";

/** The release notes' own words in Simplified Chinese, beside the English ones. */
export const notesWordsZh: NotesWords = {
  breaking: "不兼容的变更",
  feat: "新功能",
  fix: "修复",
  perf: "性能改进",
  other: "其他变更",
  first: (count) => `首个版本，包含 ${count} 个提交。`,
  since: (count, since) => `自 ${since} 以来的 ${count} 项变更。`,
};
