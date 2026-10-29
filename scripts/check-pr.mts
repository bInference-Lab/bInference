import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import process from "node:process";
import { parseArgs } from "node:util";
import { parse } from "yaml";
import { z } from "zod";
import { loadGraph } from "./package-graph/graph.mjs";
import {
  dependencyProblems,
  moneyPathProblems,
  readSections,
  sectionProblems,
} from "./pr/pr-body.mjs";
import { runCommand } from "./run-command.mjs";

interface PullRequest {
  readonly base: string;
  readonly head: string;
  readonly branch: string;
  /** The squash commit's subject, when the merge squashes; else each commit lands as it is. */
  readonly title: string | undefined;
  /** The PR body, when a file holds it; without one the body is not checked. */
  readonly body: string | undefined;
}

const sizeLimit = 400;
const branchPattern =
  /^(?:feat|fix|perf|refactor|test|docs|ci|build|chore|revert)\/[a-z0-9]+(?:-[a-z0-9]+)*$/;
const uncounted = [/\.test\.ts$/, /\.generated\.json$/, /^pnpm-lock\.yaml$/];
const manifestFields = [
  "dependencies",
  "devDependencies",
  "peerDependencies",
  "optionalDependencies",
];
const workspaceFields = ["catalog", "overrides", "allowBuilds", "minimumReleaseAgeExclude"];

const usage =
  "Usage: pnpm check:pr <base>..<branch> [--title <subject>] [--body <file>], such as " +
  "master..fix/stop.";

function git(root: string, args: readonly string[]): string {
  const result = runCommand(["git", ...args], { cwd: root });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(" ")} failed:\n${result.output}`);
  }
  return result.output.trim();
}

function isCommit(root: string, ref: string): boolean {
  return (
    runCommand(["git", "rev-parse", "--verify", "--quiet", `${ref}^{commit}`], { cwd: root })
      .status === 0
  );
}

// The range names the branch to merge as its head, so the branch name comes from git.
function readPullRequest(root: string): PullRequest | string {
  const { values, positionals } = parseArgs({
    options: { title: { type: "string" }, body: { type: "string" } },
    allowPositionals: true,
  });
  const [base = "", head = ""] = positionals.length === 1 ? (positionals[0] ?? "").split("..") : [];
  if ([base, head].some((ref) => ref.length === 0 || ref.startsWith("."))) {
    return usage;
  }
  const unknown = [base, head].find((ref) => !isCommit(root, ref));
  if (unknown !== undefined) {
    return `${unknown} is not a commit here; fetch it or check the name. ${usage}`;
  }
  if (values.body !== undefined && !existsSync(values.body)) {
    return `The body file ${values.body} does not exist. ${usage}`;
  }
  const name = runCommand(["git", "rev-parse", "--symbolic-full-name", head], { cwd: root });
  return {
    base,
    head,
    branch: name.output.trim().replace(/^refs\/heads\//, ""),
    title: values.title,
    body: values.body === undefined ? undefined : readFileSync(values.body, "utf8"),
  };
}

function commandProblems(root: string, pr: PullRequest): string[] {
  const range = `${pr.base}..${pr.head}`;
  const titleChecks: readonly [string, readonly string[], string | undefined][] =
    pr.title === undefined
      ? []
      : [
          ["the title fails commitlint", ["pnpm", "exec", "commitlint"], `${pr.title}\n`],
          ["the title fails check:style", ["pnpm", "check:style", "--text", pr.title], undefined],
        ];
  const checks: readonly [string, readonly string[], string | undefined][] = [
    ...titleChecks,
    [
      "a commit fails commitlint",
      ["pnpm", "exec", "commitlint", "--from", pr.base, "--to", pr.head],
      undefined,
    ],
    ["a commit fails check:style", ["pnpm", "check:style", "--commits", range], undefined],
  ];
  return checks.flatMap(([problem, command, input]) => {
    const result = runCommand(command, { cwd: root, ...(input === undefined ? {} : { input }) });
    return result.status === 0 ? [] : [`${problem}:\n${result.output.trim()}`];
  });
}

function changedLines(root: string, pr: PullRequest): number {
  return git(root, ["diff", "--numstat", `${pr.base}...${pr.head}`])
    .split("\n")
    .map((line) => line.split("\t"))
    .filter(
      ([, , file = ""]) => file.length > 0 && !uncounted.some((pattern) => pattern.test(file)),
    )
    .reduce(
      (total, [added = "0", removed = "0"]) =>
        total + (Number(added) || 0) + (Number(removed) || 0),
      0,
    );
}

const recordSchema = z.record(z.string(), z.unknown());

function fileAt(root: string, ref: string, file: string): string {
  const result = runCommand(["git", "show", `${ref}:${file}`], { cwd: root });
  return result.status === 0 ? result.output : "";
}

// The fields of a manifest or of pnpm-workspace.yaml that decide what gets installed.
function installFields(file: string, text: string): string {
  const isWorkspace = file === "pnpm-workspace.yaml";
  const content: unknown = isWorkspace ? parse(text) : JSON.parse(text.trim() || "{}");
  const parsed = recordSchema.parse(content ?? {});
  const fields = isWorkspace ? workspaceFields : manifestFields;
  return JSON.stringify(fields.map((field) => parsed[field] ?? null));
}

function dependenciesChanged(root: string, pr: PullRequest, changed: readonly string[]): boolean {
  return changed
    .filter((file) => file === "pnpm-workspace.yaml" || /(?:^|\/)package\.json$/.test(file))
    .some(
      (file) =>
        installFields(file, fileAt(root, pr.base, file)) !==
        installFields(file, fileAt(root, pr.head, file)),
    );
}

function bodyProblems(root: string, pr: PullRequest, changed: readonly string[]): string[] {
  if (pr.body === undefined) {
    return [];
  }
  const graph = loadGraph(root);
  const moneyFolders = Object.entries(graph.packages)
    .filter(([, row]) => row.money === true)
    .map(([key]) => `packages/${key}/`);
  const template = readSections(
    readFileSync(join(root, ".github/pull_request_template.md"), "utf8"),
  );
  const sections = readSections(pr.body);
  const money = changed.some((file) => moneyFolders.some((folder) => file.startsWith(folder)));
  const dependencies = dependenciesChanged(root, pr, changed);
  return [
    ...sectionProblems(sections),
    ...(money ? moneyPathProblems(sections, template) : []),
    ...(dependencies ? dependencyProblems(sections) : []),
  ];
}

const root = process.cwd();
const read = readPullRequest(root);
if (typeof read === "string") {
  console.error(read);
  process.exit(2);
}
const pr = read;
const changed = git(root, ["diff", "--name-only", `${pr.base}...${pr.head}`]).split("\n");
const problems = [
  ...(branchPattern.test(pr.branch)
    ? []
    : [
        `The head ${pr.head} is not a branch named <type>/<short-name>, such as fix/trailing-stop.`,
      ]),
  ...bodyProblems(root, pr, changed),
  ...commandProblems(root, pr),
];
const lines = changedLines(root, pr);
if (lines > sizeLimit) {
  console.log(
    `check:pr: the branch changes ${String(lines)} lines outside tests and generated files; ` +
      `split it into a stack of PRs under about ${String(sizeLimit)} lines each.`,
  );
}
for (const problem of problems) {
  console.error(`check:pr: ${problem}`);
}
if (pr.body === undefined) {
  console.log("check:pr: no --body file given, so the PR body was not checked.");
}
if (problems.length === 0) {
  console.log(`check:pr: the branch is ready to merge (${String(lines)} lines counted).`);
}
process.exitCode = problems.length === 0 ? 0 : 1;
