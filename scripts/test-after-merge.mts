import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import process from "node:process";
import { parseArgs } from "node:util";
import { z } from "zod";
import {
  type AfterMergePlan,
  planAfterMerge,
  type WorkspacePackage,
} from "./after-merge/after-merge-plan.mjs";
import { runCommand, runCommandShown } from "./run-command.mjs";

const usage =
  "Usage: pnpm test:after-merge [<base>..<head>] [--list]. Without a range it tests what the " +
  "last merge brought, ORIG_HEAD..HEAD; master@{1}..master names the last move of master.";

interface Range {
  readonly base: string;
  readonly head: string;
  readonly commits: string;
}

function git(root: string, args: readonly string[]): string | undefined {
  const result = runCommand(["git", ...args], { cwd: root });
  return result.status === 0 ? result.output.trim() : undefined;
}

function readRange(root: string, given: string | undefined): Range | string {
  const [base = "", head = ""] = (given ?? "ORIG_HEAD..HEAD").split("..");
  if (base.length === 0 || head.length === 0 || head.startsWith(".")) {
    return usage;
  }
  const unknown = [base, head].find(
    (ref) => git(root, ["rev-parse", "--verify", "--quiet", `${ref}^{commit}`]) === undefined,
  );
  if (unknown !== undefined) {
    return `${unknown} is not a commit here. ${usage}`;
  }
  const commits = git(root, ["rev-list", "--count", `${base}..${head}`]) ?? "0";
  return commits === "0" ? `${base}..${head} holds no commit. ${usage}` : { base, head, commits };
}

const manifestSchema = z.looseObject({
  name: z.string(),
  dependencies: z.record(z.string(), z.string()).optional(),
  devDependencies: z.record(z.string(), z.string()).optional(),
  peerDependencies: z.record(z.string(), z.string()).optional(),
});

function workspacePackageOf(root: string, folder: string): WorkspacePackage {
  const manifest = manifestSchema.parse(
    JSON.parse(readFileSync(join(root, folder, "package.json"), "utf8")),
  );
  const { dependencies = {}, devDependencies = {}, peerDependencies = {} } = manifest;
  const dependsOn = Object.entries({ ...dependencies, ...devDependencies, ...peerDependencies })
    .filter(([, version]) => version.startsWith("workspace:"))
    .map(([name]) => name);
  return { folder, name: manifest.name, dependsOn };
}

// The package folders that hold tests, each with the workspace packages it depends on.
function workspacePackages(root: string): readonly WorkspacePackage[] {
  return ["packages", "plugins"].flatMap((parent) =>
    existsSync(join(root, parent))
      ? readdirSync(join(root, parent), { withFileTypes: true })
          .filter(
            (entry) => entry.isDirectory() && existsSync(join(root, parent, entry.name, "src")),
          )
          .map((entry) => workspacePackageOf(root, `${parent}/${entry.name}`))
      : [],
  );
}

function printPlan(range: Range, changed: number, plan: AfterMergePlan): void {
  console.log(
    `test:after-merge: ${range.base}..${range.head} brings ${range.commits} commits ` +
      `and changes ${String(changed)} files.`,
  );
  console.log(
    plan.packages.length === 0 ? "Packages: none changed." : "Packages, all of their tests:",
  );
  for (const { folder, why } of plan.packages) {
    console.log(`  ${folder}: ${why}`);
  }
  console.log("Table tests, which any merge can break:");
  for (const { name, why, files } of plan.tables) {
    console.log(`  ${name}: ${why} (${String(files.length)} files)`);
  }
  console.log("Repo checks:");
  for (const { script, why } of plan.checks) {
    console.log(`  ${script}: ${why}`);
  }
  console.log(`  check:gates: ${plan.gates ?? "not run, no gate's script or config changed"}`);
}

function runChecks(root: string, plan: AfterMergePlan): readonly string[] {
  return plan.checks.flatMap(({ script }) => {
    const result = runCommand(["pnpm", script], { cwd: root });
    console.log(`${result.status === 0 ? "ok    " : "FAILED"} ${script}`);
    if (result.status !== 0) {
      console.error(result.output.trim());
    }
    return result.status === 0 ? [] : [script];
  });
}

function runTests(root: string, plan: AfterMergePlan): boolean {
  const filters = [
    ...plan.packages.map(({ folder }) => `${folder}/`),
    ...plan.tables.flatMap(({ files }) => files),
  ];
  const status = runCommandShown(
    ["pnpm", "exec", "vitest", "run", ...filters, "--maxWorkers=50%"],
    { cwd: root },
  );
  return status === 0;
}

const root = process.cwd();
const { values, positionals } = parseArgs({
  options: { list: { type: "boolean", default: false } },
  allowPositionals: true,
});
const range = positionals.length > 1 ? usage : readRange(root, positionals[0]);
if (typeof range === "string") {
  console.error(`test:after-merge: ${range}`);
  process.exit(2);
}
const changed = (git(root, ["diff", "--name-only", `${range.base}...${range.head}`]) ?? "")
  .split("\n")
  .filter((file) => file.length > 0);
const plan = planAfterMerge(changed, workspacePackages(root));
const missing = plan.tables.flatMap(({ files }) => files).filter((file) => !existsSync(file));
if (missing.length > 0) {
  console.error(
    `test:after-merge: these table tests are gone: ${missing.join(", ")}. Name their new ` +
      "files in scripts/after-merge/after-merge-plan.mts.",
  );
  process.exit(1);
}
printPlan(range, changed.length, plan);
if (values.list) {
  process.exit(0);
}
const failedChecks = runChecks(root, plan);
const testsPassed = runTests(root, plan);
// check:gates runs its own shards and fills the cores, so it runs after the tests, alone.
const gatesPassed =
  plan.gates === undefined || runCommandShown(["pnpm", "check:gates"], { cwd: root }) === 0;
const failed = [
  ...failedChecks,
  ...(testsPassed ? [] : ["the tests"]),
  ...(gatesPassed ? [] : ["check:gates"]),
];
console.log(
  failed.length === 0
    ? "test:after-merge: every chosen check and test passed."
    : `test:after-merge: failed: ${failed.join(", ")}. Fix master before the next merge.`,
);
process.exitCode = failed.length === 0 ? 0 : 1;
