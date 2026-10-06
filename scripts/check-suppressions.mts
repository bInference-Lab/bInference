import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import process from "node:process";
import { readAtBase } from "./git-base.mjs";
import { listRepoFiles } from "./repo-files.mjs";

interface Problem {
  readonly where: string;
  readonly message: string;
}

const baselinePath = "config/size-baseline.txt";
const sizeRules = new Set([
  "max-lines",
  "max-lines-per-function",
  "complexity",
  "max-depth",
  "max-params",
]);
const sourceFile = /\.(?:[cm]?[jt]sx?)$/;
const directive = /(?:\/\/|\/\*)\s*(?:oxlint|eslint)-disable(?:-next-line|-line)?\b(.*)/;
const expectError = /(?:\/\/|\/\*)\s*@ts-expect-error\b(.*)/;

function readBaseline(text: string): readonly string[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"));
}

function ruleNames(rest: string): readonly string[] {
  const rules = rest.split(" -- ")[0] ?? "";
  return rules
    .replace(/\*\/.*$/, "")
    .split(",")
    .map((rule) => rule.trim())
    .filter((rule) => rule.length > 0);
}

function stripCommentEnd(text: string): string {
  return text.replace(/\*\/.*$/, "").trim();
}

function expectErrorProblems(line: string): string[] {
  const expected = expectError.exec(line);
  if (expected === null) {
    return [];
  }
  return stripCommentEnd(expected[1] ?? "").length < 10
    ? ["@ts-expect-error needs its reason."]
    : [];
}

function directiveProblems(file: string, line: string, baseline: readonly string[]): string[] {
  const match = directive.exec(line);
  if (match === null) {
    return expectErrorProblems(line);
  }
  const rest = match[1] ?? "";
  const rules = ruleNames(rest);
  const reason = stripCommentEnd(rest.split(" -- ")[1] ?? "");
  const sized = rules.filter((rule) => sizeRules.has(rule.replace(/^eslint\//, "")));
  const outsideBaseline = sized.length > 0 && !baseline.includes(file);
  return [
    ...(rules.length === 0 ? ["a suppression names the rules it turns off."] : []),
    ...(reason.length === 0 ? ['a suppression gives its reason after " -- ".'] : []),
    ...(outsideBaseline
      ? [`${sized.join(", ")} may be suppressed only in files listed in ${baselinePath}.`]
      : []),
  ];
}

function fileProblems(root: string, file: string, baseline: readonly string[]): Problem[] {
  return readFileSync(join(root, file), "utf8")
    .split("\n")
    .flatMap((line, index) =>
      directiveProblems(file, line, baseline).map((message) => ({
        where: `${file}:${String(index + 1)}`,
        message,
      })),
    );
}

// The baseline may only shrink: an entry missing at the merge base is a new exception.
function baselineGrowth(root: string, current: readonly string[]): Problem[] {
  const before = readAtBase(root, baselinePath);
  const previous = before === undefined ? [] : readBaseline(before);
  return current
    .filter((entry) => !previous.includes(entry))
    .map((entry) => ({
      where: baselinePath,
      message: `${entry} is new; the size baseline only shrinks. Split the file instead.`,
    }));
}

const root = process.cwd();
const baselineFile = join(root, baselinePath);
const baseline = existsSync(baselineFile) ? readBaseline(readFileSync(baselineFile, "utf8")) : [];
const files = listRepoFiles(root).filter((file) => sourceFile.test(file));
const problems = [
  ...files.flatMap((file) => fileProblems(root, file, baseline)),
  ...baselineGrowth(root, baseline),
];
for (const item of problems) {
  console.error(`${item.where}: check:suppressions: ${item.message}`);
}
if (problems.length === 0) {
  console.log(
    `check:suppressions: ${String(files.length)} files, ${String(baseline.length)} in the baseline.`,
  );
}
process.exitCode = problems.length === 0 ? 0 : 1;
