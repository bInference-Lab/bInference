import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import process from "node:process";
import { referenceState } from "./references/reference-state.mjs";

const root = process.cwd();
const { files, behind, extra, missing } = referenceState(root);
for (const item of behind) {
  mkdirSync(dirname(join(root, item.file)), { recursive: true });
  writeFileSync(join(root, item.file), item.text);
}
for (const file of extra) {
  rmSync(join(root, file), { recursive: true });
}
const written = behind.length === 0 ? "every file was current" : `wrote ${String(behind.length)}`;
const removed = extra.length === 0 ? "" : `, removed ${extra.join(", ")}`;
console.log(`docs:gen: ${String(files.length)} generated files; ${written}${removed}.`);
// A page renders only once every text it shows has its message in English and Chinese.
for (const item of missing) {
  console.error(item.problem);
}
console.log(`docs:gen: texts without their English or Chinese message: ${String(missing.length)}.`);
process.exitCode = missing.length === 0 ? 0 : 1;
