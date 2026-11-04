import process from "node:process";
import { referenceState } from "./references/reference-state.mjs";

const { files, behind, extra, missing } = referenceState(process.cwd());
for (const item of missing) {
  console.error(item.problem);
}
for (const item of behind) {
  console.error(
    `${item.file}: check:references: the file is behind the code. Run pnpm docs:gen and commit ` +
      "it; never edit a generated file by hand.",
  );
}
for (const file of extra) {
  console.error(
    `${file}: check:references: no code generates this file, and a reference folder holds only ` +
      "generated pages. Run pnpm docs:gen to remove it, and put a page of your own under guides/.",
  );
}
const problems = missing.length + behind.length + extra.length;
if (problems === 0) {
  console.log(
    `check:references: ${String(files.length)} generated files match the code, and every text ` +
      "they show has its English and Chinese message.",
  );
}
process.exitCode = problems === 0 ? 0 : 1;
