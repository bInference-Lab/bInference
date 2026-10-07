import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { availableParallelism, tmpdir } from "node:os";
import { join } from "node:path";
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
import { openSandbox } from "./gates/sandbox.mjs";
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

// Longest cases first, so the last ones to start are short; deterministic, so every shard process
// walks the same order.
function ordered(cases: readonly GateCase[]): readonly GateCase[] {
  return cases.toSorted((a, b) => (b.cost ?? 1) - (a.cost ?? 1) || a.name.localeCompare(b.name));
}

// A shard takes a case by making its folder among the claims. Making a folder succeeds for exactly
// one process on every platform, so each case runs once, on whichever shard is free first.
function claim(claims: string, index: number): boolean {
  try {
    mkdirSync(join(claims, String(index)));
    return true;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "EEXIST") {
      return false;
    }
    throw error;
  }
}

// Runs the cases this shard claims, one after another, in its own sandbox.
function runShard(cases: readonly GateCase[], claims: string): number {
  const sandbox = openSandbox(process.cwd());
  let ran = 0;
  let failed = 0;
  try {
    for (const [index, item] of ordered(cases).entries()) {
      if (!claim(claims, index)) {
        continue;
      }
      const started = performance.now();
      const problem = runCase(sandbox, item);
      const seconds = ((performance.now() - started) / 1000).toFixed(1);
      ran += 1;
      failed += problem === undefined ? 0 : 1;
      console.log(
        problem === undefined
          ? `ok    ${item.name} (${seconds} s)`
          : `FAIL  ${item.name} (${seconds} s)\n${problem}\n`,
      );
    }
  } finally {
    sandbox.release();
  }
  console.log(`${String(ran - failed)} of ${String(ran)} gate cases behaved.`);
  return failed === 0 ? 0 : 1;
}

// Each shard is its own process with its own sandbox, so cases never share a working tree. Shards
// take cases as they free up, so a slow case never leaves the others waiting on a fixed plan.
async function runShards(
  count: number,
  filter: readonly string[],
  expected: number,
): Promise<number> {
  const claims = mkdtempSync(join(tmpdir(), "binference-gate-claims-"));
  try {
    const shards = Array.from({ length: count }, () =>
      runCommandAsync(
        ["node", "--import", "tsx", "scripts/check-gates.mts", "--claims", claims, ...filter],
        {
          cwd: process.cwd(),
        },
      ),
    );
    const results = await Promise.all(shards);
    const totals = results.map((result) => summary.exec(result.output));
    for (const result of results) {
      console.log(result.output.replace(summary, "").trim());
    }
    const behaved = totals.reduce((sum, match) => sum + Number(match?.[1] ?? 0), 0);
    const total = totals.reduce((sum, match) => sum + Number(match?.[2] ?? 0), 0);
    console.log(`${String(behaved)} of ${String(expected)} gate cases behaved.`);
    const clean = results.every((result, index) => result.status === 0 && totals[index] !== null);
    return clean && total === expected ? 0 : 1;
  } finally {
    rmSync(claims, { recursive: true, force: true });
  }
}

const claims = optionValue("--claims");
const options = new Set(["--claims"]);
const filter = process.argv
  .slice(2)
  .filter((arg, index, args) => !options.has(arg) && !options.has(args[index - 1] ?? ""));
const selected = allCases(process.cwd()).filter((item) =>
  filter.every((part) => item.name.includes(part)),
);
if (claims === undefined) {
  // Six shards measured fastest on 18 cores; more shards only compete for the CPU.
  const fitted = Math.min(6, Math.max(2, Math.floor(availableParallelism() / 3)));
  const wanted = Number(process.env["GATE_SHARDS"] ?? fitted);
  const count = Math.max(1, Math.min(wanted, selected.length));
  process.exitCode = await runShards(count, filter, selected.length);
} else {
  process.exitCode = runShard(selected, claims);
}
