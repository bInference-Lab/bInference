import { availableParallelism } from "node:os";
import process from "node:process";
import { agentCases } from "./gates/agent-cases.mjs";
import { chainLiteralCases } from "./gates/chain-literal-cases.mjs";
import { checkCases } from "./gates/check-cases.mjs";
import { commitCases } from "./gates/commit-cases.mjs";
import { configSchemaCases } from "./gates/config-schema-cases.mjs";
import { contractCases } from "./gates/contract-cases.mjs";
import { decisionCases } from "./gates/decision-cases.mjs";
import { docsAndTsdocCases } from "./gates/docs-cases.mjs";
import { runCase, type GateCase } from "./gates/gate-case.mjs";
import { graphCases, tsconfigCases } from "./gates/graph-cases.mjs";
import { hygieneCases } from "./gates/hygiene-cases.mjs";
import { i18nCases } from "./gates/i18n-cases.mjs";
import { lintCases } from "./gates/lint-cases.mjs";
import { prCases } from "./gates/pr-cases.mjs";
import { protocolCases } from "./gates/protocol-cases.mjs";
import { createSandbox } from "./gates/sandbox.mjs";
import { storeCases } from "./gates/store-cases.mjs";
import { styleCases } from "./gates/style-cases.mjs";
import { testCases } from "./gates/test-cases.mjs";
import { workspaceCases } from "./gates/workspace-cases.mjs";
import { runCommandAsync } from "./run-command.mjs";

const summary = /^(\d+) of (\d+) gate cases behaved\.$/m;

function allCases(repo: string): readonly GateCase[] {
  return [
    ...workspaceCases(repo),
    ...lintCases(),
    ...graphCases(repo),
    ...tsconfigCases(),
    ...testCases(repo),
    ...styleCases(repo),
    ...hygieneCases(repo),
    ...decisionCases(repo),
    ...docsAndTsdocCases(),
    ...contractCases(),
    ...chainLiteralCases(),
    ...protocolCases(repo),
    ...i18nCases(repo),
    ...configSchemaCases(repo),
    ...storeCases(repo),
    ...commitCases(),
    ...checkCases(),
    ...prCases(repo),
    ...agentCases(repo),
  ];
}

function optionValue(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

// Runs one shard's cases, one after another, in its own sandbox.
function runShard(cases: readonly GateCase[]): number {
  const sandbox = createSandbox(process.cwd());
  let failed = 0;
  try {
    for (const item of cases) {
      const problem = runCase(sandbox, item);
      failed += problem === undefined ? 0 : 1;
      console.log(
        problem === undefined ? `ok    ${item.name}` : `FAIL  ${item.name}\n${problem}\n`,
      );
    }
  } finally {
    sandbox.dispose();
  }
  console.log(`${String(cases.length - failed)} of ${String(cases.length)} gate cases behaved.`);
  return failed === 0 ? 0 : 1;
}

// Each shard is its own process with its own sandbox, so cases never share a working tree.
async function runShards(count: number, filter: readonly string[]): Promise<number> {
  const shards = Array.from({ length: count }, (_, index) =>
    runCommandAsync(
      [
        "node",
        "--import",
        "tsx",
        "scripts/check-gates.mts",
        "--shard",
        `${String(index)}/${String(count)}`,
        ...filter,
      ],
      { cwd: process.cwd() },
    ),
  );
  const results = await Promise.all(shards);
  const totals = results.map((result) => summary.exec(result.output));
  for (const result of results) {
    console.log(result.output.replace(summary, "").trim());
  }
  const behaved = totals.reduce((sum, match) => sum + Number(match?.[1] ?? 0), 0);
  const total = totals.reduce((sum, match) => sum + Number(match?.[2] ?? 0), 0);
  console.log(`${String(behaved)} of ${String(total)} gate cases behaved.`);
  const clean = results.every((result, index) => result.status === 0 && totals[index] !== null);
  return clean ? 0 : 1;
}

// Longest cases first, each to the shard with the least work so far; deterministic, so every
// shard process computes the same plan and takes its own part.
function plan(cases: readonly GateCase[], count: number): readonly (readonly GateCase[])[] {
  const loads = Array.from({ length: count }, () => 0);
  const parts: GateCase[][] = Array.from({ length: count }, () => []);
  const ordered = cases.toSorted(
    (a, b) => (b.cost ?? 1) - (a.cost ?? 1) || a.name.localeCompare(b.name),
  );
  for (const item of ordered) {
    const target = loads.indexOf(Math.min(...loads));
    loads[target] = (loads[target] ?? 0) + (item.cost ?? 1);
    parts[target]?.push(item);
  }
  return parts;
}

const shard = optionValue("--shard");
const options = new Set(["--shard"]);
const filter = process.argv
  .slice(2)
  .filter((arg, index, args) => !options.has(arg) && !options.has(args[index - 1] ?? ""));
const selected = allCases(process.cwd()).filter((item) =>
  filter.every((part) => item.name.includes(part)),
);
if (shard === undefined) {
  // Six shards measured fastest on 18 cores; more shards only compete for the CPU.
  const fitted = Math.min(6, Math.max(2, Math.floor(availableParallelism() / 3)));
  const wanted = Number(process.env["GATE_SHARDS"] ?? fitted);
  const count = Math.max(1, Math.min(wanted, selected.length));
  process.exitCode = await runShards(count, filter);
} else {
  const [index = 0, count = 1] = shard.split("/").map(Number);
  process.exitCode = runShard(plan(selected, count)[index] ?? []);
}
