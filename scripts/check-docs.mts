import process from "node:process";
import { listRepoFiles } from "./repo-files.mjs";

// Starlight keeps English at the content root and each other language in its own folder.
const docsRoot = "apps/docs/src/content/docs/";
const chineseRoot = `${docsRoot}zh-cn/`;
const page = /\.mdx?$/;

interface Pair {
  readonly file: string;
  readonly twin: string;
  readonly message: string;
}

// Every English page has its Chinese twin under zh-cn/, and every Chinese page has its English.
function pairOf(file: string): Pair {
  if (file.startsWith(chineseRoot)) {
    const twin = `${docsRoot}${file.slice(chineseRoot.length)}`;
    return { file, twin, message: "has no English twin" };
  }
  const twin = `${chineseRoot}${file.slice(docsRoot.length)}`;
  return { file, twin, message: "has no Chinese twin" };
}

const files = listRepoFiles(process.cwd()).filter(
  (file) => file.startsWith(docsRoot) && page.test(file),
);
const present = new Set(files);
const pairs = files.map(pairOf);
const missing = pairs.filter((pair) => !present.has(pair.twin));
for (const pair of missing) {
  console.error(`${pair.file}: check:docs: ${pair.message} ${pair.twin}.`);
}
if (missing.length === 0) {
  console.log(`check:docs: ${String(pairs.length)} docs pages, each with its twin.`);
}
process.exitCode = missing.length === 0 ? 0 : 1;
