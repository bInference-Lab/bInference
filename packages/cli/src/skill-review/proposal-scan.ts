import { lintSkill } from "@binference/plugin-sdk";
import type { SkillFindingView, SkillSupportFile } from "@binference/protocol";

/** The most findings a proposal keeps; each finding blocks it, so more add nothing. */
const maxFindings = 50;
/** The most of a finding's sentence a surface is shown. */
const maxFindingText = 200;

// A removal of a root, a home folder or binference's own folder: `rm` with a recursive or forced
// flag before `/`, `/*`, `~`, `~/`, `$HOME` or `~/.binference`, and PowerShell's `Remove-Item`
// with `-Recurse` on a drive's root, the home folder or the profile.
const destructive: readonly RegExp[] = [
  /\brm\s+(?:-{1,2}[\w-]+\s+)*-{1,2}[\w-]*[rRf][\w-]*\s+(?:-{1,2}[\w-]+\s+)*["']?(?:\/\*?|~\/?|~\/\.binference\b\S*|\$\{?HOME\}?\/?)["']?(?=$|[\s;&|)`])/m,
  /\bRemove-Item\b[^\n]*-Recurse[^\n]*(?:[A-Za-z]:\\(?=$|[\s"'])|\$HOME\b|\$env:USERPROFILE\b|~(?=$|[\s"'\\/]))/im,
];

function cut(text: string): string {
  return text.length <= maxFindingText ? text : `${text.slice(0, maxFindingText - 1)}…`;
}

function destructiveFindings(file: string, text: string): readonly SkillFindingView[] {
  return text
    .split("\n")
    .flatMap((line, index) =>
      destructive.some((rule) => rule.test(line))
        ? [{ file, line: index + 1, code: "destructive_delete", text: cut(line.trim()) }]
        : [],
    );
}

function fileFindings(file: string, text: string): readonly SkillFindingView[] {
  const lint = lintSkill(text).map(({ code, line, text: sentence }) => ({
    file,
    line,
    code,
    text: cut(sentence),
  }));
  return [...lint, ...destructiveFindings(file, text)];
}

/**
 * Scans a skill proposal (decision 0408): the skill lint on `SKILL.md` and each support file, which
 * finds requests for secrets, downloads piped into a shell, secret stores sent away, secrets
 * written out and hidden characters, and a removal of the root, the home folder or binference's
 * own folder (`destructive_delete`). Each finding names its file and line; at most 50 are kept,
 * each sentence cut to 200 characters. Every finding blocks the proposal's apply.
 */
export function scanProposal(
  text: string,
  supportFiles: readonly SkillSupportFile[],
): readonly SkillFindingView[] {
  return [
    ...fileFindings("SKILL.md", text),
    ...supportFiles.flatMap((file) => fileFindings(file.path, file.text)),
  ].slice(0, maxFindings);
}
