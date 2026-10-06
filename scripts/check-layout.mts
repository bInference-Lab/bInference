import process from "node:process";
import {
  agentFileProblems,
  agentRuleProblems,
  namingProblems,
  packageProblems,
  propertyTestProblems,
  shellProblems,
  testProblems,
  type RepoView,
} from "./layout/layout-rules.mjs";
import {
  hookProblems,
  listedSkillProblems,
  repoSettingProblems,
  skillProblems,
} from "./layout/repo-rules.mjs";
import { listRepoFiles } from "./repo-files.mjs";

const root = process.cwd();
const repo: RepoView = { root, files: listRepoFiles(root) };
const problems = [
  ...namingProblems(repo),
  ...packageProblems(repo),
  ...agentFileProblems(repo),
  ...agentRuleProblems(repo),
  ...shellProblems(repo),
  ...testProblems(repo),
  ...propertyTestProblems(repo),
  ...repoSettingProblems(repo),
  ...skillProblems(repo),
  ...listedSkillProblems(repo),
  ...hookProblems(repo),
];
for (const item of problems) {
  console.error(`check:layout(${item.rule}): ${item.message}`);
}
if (problems.length === 0) {
  console.log(`check:layout: ${String(repo.files.length)} files follow the layout.`);
}
process.exitCode = problems.length === 0 ? 0 : 1;
