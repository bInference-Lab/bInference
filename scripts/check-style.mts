import { readFileSync } from "node:fs";
import { extname, join } from "node:path";
import process from "node:process";
import { listRepoFiles } from "./repo-files.mjs";
import { runCommand } from "./run-command.mjs";
import { createMessageScanner, createTextScanner, type Finding } from "./style/scan-text.mjs";
import { loadWordLists, styleFolder } from "./style/word-lists.mjs";

const binaryExtensions = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".ico",
  ".webp",
  ".woff",
  ".woff2",
  ".ttf",
  ".pdf",
  ".zip",
  ".gz",
  ".mp4",
]);
// The word lists hold what they ban; generated files and the lockfile hold no prose.
const skipped = [
  (file: string) => file.startsWith(`${styleFolder}/`),
  (file: string) => file === "pnpm-lock.yaml",
  (file: string) => file.endsWith(".generated.json"),
];

function git(repo: string, args: readonly string[]): string {
  const result = runCommand(["git", ...args], { cwd: repo });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(" ")} failed:\n${result.output}`);
  }
  return result.output;
}

function readText(repo: string, file: string): string | undefined {
  if (binaryExtensions.has(extname(file).toLowerCase()) || skipped.some((skip) => skip(file))) {
    return undefined;
  }
  const text = readFileSync(join(repo, file), "utf8");
  return text.includes("\0") ? undefined : text;
}

function commitMessages(repo: string, range: string): readonly [string, string][] {
  return git(repo, ["rev-list", "--reverse", range])
    .split("\n")
    .map((sha) => sha.trim())
    .filter((sha) => sha.length > 0)
    .map((sha) => [`commit ${sha.slice(0, 12)}`, git(repo, ["log", "-1", "--format=%B", sha])]);
}

function optionValue(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

function scan(repo: string): readonly Finding[] {
  const lists = loadWordLists(repo);
  const scanText = createTextScanner(lists);
  const scanMessage = createMessageScanner(lists);
  const messageFile = optionValue("--message-file");
  const title = optionValue("--text");
  const range = optionValue("--commits");
  if (messageFile !== undefined) {
    return scanMessage(messageFile, readFileSync(messageFile, "utf8"));
  }
  if (title !== undefined) {
    return scanMessage("title", title);
  }
  if (range !== undefined) {
    return commitMessages(repo, range).flatMap(([where, message]) => scanMessage(where, message));
  }
  const filesIndex = process.argv.indexOf("--files");
  const files = filesIndex === -1 ? listRepoFiles(repo) : process.argv.slice(filesIndex + 1);
  return files.flatMap((file) => {
    const text = readText(repo, file);
    return text === undefined ? [] : scanText(file, text);
  });
}

const findings = scan(process.cwd());
for (const item of findings) {
  console.error(`${item.where}:${String(item.line)}: check:style(${item.rule}): ${item.message}`);
}
if (findings.length === 0) {
  console.log("check:style: no style problems.");
}
process.exitCode = findings.length === 0 ? 0 : 1;
