import process from "node:process";
import { agentCases } from "./gates/agent-cases.mjs";
import { checkCases } from "./gates/check-cases.mjs";
import { commitCases } from "./gates/commit-cases.mjs";
import { contractCases } from "./gates/contract-cases.mjs";
import { decisionCases } from "./gates/decision-cases.mjs";
import { docsAndTsdocCases } from "./gates/docs-cases.mjs";
import { runCase } from "./gates/gate-case.mjs";
import { graphCases, tsconfigCases } from "./gates/graph-cases.mjs";
import { hygieneCases } from "./gates/hygiene-cases.mjs";
import { lintCases } from "./gates/lint-cases.mjs";
import { prCases } from "./gates/pr-cases.mjs";
import { createSandbox } from "./gates/sandbox.mjs";
import { styleCases } from "./gates/style-cases.mjs";
import { testCases } from "./gates/test-cases.mjs";
import { workspaceCases } from "./gates/workspace-cases.mjs";

const repo = process.cwd();
const cases = [
  ...workspaceCases(repo),
  ...lintCases(),
  ...graphCases(repo),
  ...tsconfigCases(),
  ...testCases(),
  ...styleCases(repo),
  ...hygieneCases(repo),
  ...decisionCases(repo),
  ...docsAndTsdocCases(),
  ...contractCases(),
  ...commitCases(),
  ...checkCases(),
  ...prCases(repo),
  ...agentCases(repo),
];
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
