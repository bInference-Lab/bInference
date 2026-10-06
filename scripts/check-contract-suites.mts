import { existsSync } from "node:fs";
import { join } from "node:path";
import process from "node:process";
import {
  findImplementations,
  findPorts,
  findSuites,
  readSource,
  suiteName,
} from "./contracts/source-scan.mjs";
import { listRepoFiles } from "./repo-files.mjs";

const root = process.cwd();
const files = listRepoFiles(root);
const ports = findPorts(root, files);
const suites = findSuites(root, files);
const implementations = findImplementations(root, files, ports);

const missingSuites = ports
  .filter((port) => !suites.has(`${port.packageRoot}#${suiteName(port.name)}`))
  .map(
    (port) =>
      `${port.file}: check:contract-suites: the port ${port.name} has no contract suite; export ` +
      `${suiteName(port.name)} from a *-contract.ts file in ${port.packageRoot}.`,
  );

// Every adapter or fake proves the port's behavior by running the port's suite in its own test.
const unproven = implementations
  .filter(({ port, file }) => {
    const test = file.replace(/\.ts$/, ".test.ts");
    return (
      !existsSync(join(root, test)) || !readSource(root, test).includes(`${suiteName(port.name)}(`)
    );
  })
  .map(
    ({ port, file }) =>
      `${file}: check:contract-suites: implements ${port.name}, but ` +
      `${file.replace(/\.ts$/, ".test.ts")} never calls ${suiteName(port.name)}.`,
  );

const problems = [...missingSuites, ...unproven];
for (const problem of problems) {
  console.error(problem);
}
if (problems.length === 0) {
  console.log(
    `check:contract-suites: ${String(ports.length)} ports with suites, ` +
      `${String(implementations.length)} implementations that run them.`,
  );
}
process.exitCode = problems.length === 0 ? 0 : 1;
