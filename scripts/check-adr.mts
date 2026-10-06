import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import process from "node:process";
import {
  lockables,
  lockPath,
  lockProblems,
  parseLock,
  withNewEntries,
} from "./adr/decision-lock.mjs";
import { decisionsPath, parseDecisionPage, type AdrProblem } from "./adr/decision-page.mjs";
import { numberingProblems } from "./adr/numbering.mjs";
import { readRecords, recordProblems } from "./adr/record-files.mjs";
import { statusProblems } from "./adr/status-rules.mjs";
import { readAtBase } from "./git-base.mjs";
import { listRepoFiles } from "./repo-files.mjs";

function readIfPresent(root: string, path: string): string | undefined {
  const file = join(root, path);
  return existsSync(file) ? readFileSync(file, "utf8") : undefined;
}

function check(root: string, write: "write" | "check"): readonly AdrProblem[] {
  const pageText = readIfPresent(root, decisionsPath);
  if (pageText === undefined) {
    return [{ where: decisionsPath, message: "the decisions page is missing." }];
  }
  const page = parseDecisionPage(pageText);
  const { records, problems: folderProblems } = readRecords(root, listRepoFiles(root));
  const items = lockables(page.rows, records);
  let lock = parseLock(readIfPresent(root, lockPath));
  if (write === "write") {
    lock = withNewEntries(items, lock);
    writeFileSync(join(root, lockPath), `${JSON.stringify(lock, null, 2)}\n`);
  }
  return [
    ...page.problems,
    ...folderProblems,
    ...records.flatMap(recordProblems),
    ...numberingProblems(page.rows, records),
    ...statusProblems(page.rows, records),
    ...lockProblems(items, lock, parseLock(readAtBase(root, lockPath))),
  ];
}

const problems = check(process.cwd(), process.argv.includes("--write") ? "write" : "check");
for (const item of problems) {
  console.error(`${item.where}: check:adr: ${item.message}`);
}
if (problems.length === 0) {
  console.log("check:adr: every decision is numbered, listed and locked.");
}
process.exitCode = problems.length === 0 ? 0 : 1;
