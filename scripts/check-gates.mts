import process from "node:process";
import { runCase } from "./gates/gate-case.mjs";
import { createSandbox } from "./gates/sandbox.mjs";
import { workspaceCases } from "./gates/workspace-cases.mjs";

const repo = process.cwd();
const cases = [...workspaceCases(repo)];
const filter = process.argv[2];
const selected = filter === undefined ? cases : cases.filter((item) => item.name.includes(filter));
const sandbox = createSandbox(repo);
let failed = 0;
try {
  for (const item of selected) {
    const problem = runCase(sandbox, item);
    failed += problem === undefined ? 0 : 1;
    console.log(problem === undefined ? `ok    ${item.name}` : `FAIL  ${item.name}\n${problem}\n`);
  }
} finally {
  sandbox.dispose();
}
const behaved = selected.length - failed;
console.log(`${String(behaved)} of ${String(selected.length)} gate cases behaved.`);
process.exitCode = failed === 0 ? 0 : 1;
