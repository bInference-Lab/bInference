import { posix } from "node:path";
import process from "node:process";
import { listRepoFiles } from "./repo-files.mjs";

const docsRoot = "apps/docs/";
const englishPage = /(?<!\.zh)\.(mdx?)$/;
const chinesePage = /\.zh\.(mdx?)$/;

interface Pair {
  readonly file: string;
  readonly twin: string;
  readonly message: string;
}

// Every English page and meta file has a Chinese twin beside it, and every twin has its English.
function pairOf(file: string): Pair | undefined {
  const name = posix.basename(file);
  const folder = posix.dirname(file);
  if (name === "meta.json") {
    return { file, twin: posix.join(folder, "meta.zh.json"), message: "has no Chinese twin" };
  }
  if (name === "meta.zh.json") {
    return { file, twin: posix.join(folder, "meta.json"), message: "has no English twin" };
  }
  if (chinesePage.test(file)) {
    return { file, twin: file.replace(chinesePage, ".$1"), message: "has no English twin" };
  }
  if (englishPage.test(file)) {
    return { file, twin: file.replace(englishPage, ".zh.$1"), message: "has no Chinese twin" };
  }
  return undefined;
}

const files = listRepoFiles(process.cwd()).filter((file) => file.startsWith(docsRoot));
const present = new Set(files);
const pairs = files.map(pairOf).filter((pair) => pair !== undefined);
const missing = pairs.filter((pair) => !present.has(pair.twin));
for (const pair of missing) {
  console.error(`${pair.file}: check:docs: ${pair.message} ${pair.twin}.`);
}
if (missing.length === 0) {
  console.log(`check:docs: ${String(pairs.length)} docs files, each with its twin.`);
}
process.exitCode = missing.length === 0 ? 0 : 1;
