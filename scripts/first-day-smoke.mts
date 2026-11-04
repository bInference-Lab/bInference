import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import { parseArgs } from "node:util";
import { z } from "zod";
import { runOneLiner, serveRelease } from "./install/one-liner.mjs";
import { stageInstallScripts } from "./release/install-scripts.mjs";
import { packPackage } from "./release/pack-release.mjs";
import { readWorkspace } from "./release/workspace-manifests.mjs";
import { runCommand, runCommandShown } from "./run-command.mjs";

// The first-day smoke (decision 0359): the owner's whole first day on two packed releases, each
// step timed into a JSON report in reports/first-day/. It packs binference at release A and B the
// way release:dry packs it, nightly-private so no publish takes them, with the install scripts
// beside them and the commit they came from. Then the install one-liner, served from 127.0.0.1
// in place of binference.io, installs A into a scratch home folder with the pinned Node from
// nodejs.org, and packages/cli/src/packed/first-day.ts goes on from there: init --yes from
// variables, start, a paper trade by chat, status, update to B, uninstall. Stand-ins for
// launchctl, systemctl and loginctl come first on PATH and log any call, which fails the run.
// With --privy real the day runs on Privy's dev app and ends by removing what it made there;
// otherwise on the fake. It touches nothing outside its folders.

const usage =
  "Usage: pnpm first-day:smoke [--pack-only] [--packed <folder>] [--privy fake|real]. With no " +
  "flag it packs two releases into reports/first-day/packed and runs the first day on them on " +
  "the fake Privy; --pack-only only packs; --packed runs the first day on a folder an earlier " +
  "pack wrote; --privy real runs it on Privy's dev app, whose id and secret " +
  "BINFERENCE_PRIVY_APP_ID and BINFERENCE_PRIVY_APP_SECRET hold.";
const versions = { from: "2026.11.0", to: "2026.11.1" } as const;
const driver = "packages/cli/src/packed/first-day.ts";
const root = process.cwd();
const out = join(root, "reports", "first-day");

const reportSchema = z.looseObject({
  privy: z.string(),
  steps: z.array(z.looseObject({ step: z.string(), seconds: z.number(), outcome: z.string() })),
});

interface Ask {
  readonly packOnly: boolean;
  readonly packed: string | undefined;
  readonly privy: "fake" | "real";
}

function fail(message: string): never {
  console.error(`first-day:smoke: ${message}`);
  process.exit(1);
}

function readArguments(): Ask {
  try {
    const { values } = parseArgs({
      options: {
        "pack-only": { type: "boolean" },
        packed: { type: "string" },
        privy: { type: "string", default: "fake" },
      },
    });
    const privy = z.enum(["fake", "real"]).parse(values.privy);
    return { packOnly: values["pack-only"] === true, packed: values.packed, privy };
  } catch {
    return fail(usage);
  }
}

// The commit the sources are at, and whether a tracked file differs from it.
function sourcesState(): { readonly commit: string; readonly isChanged: boolean } {
  const head = runCommand(["git", "rev-parse", "HEAD"], { cwd: root });
  const changes = runCommand(["git", "status", "--porcelain", "--untracked-files=no"], {
    cwd: root,
  });
  if (head.status !== 0 || changes.status !== 0) {
    return fail(`git could not read the sources:\n${head.output}${changes.output}`);
  }
  return { commit: head.output.trim(), isChanged: changes.output.trim().length > 0 };
}

// Builds binference from a commit with no tracked change, then packs it at A and B into `folder`
// with the install scripts beside them and the commit named.
function pack(folder: string): void {
  const sources = sourcesState();
  if (sources.isChanged) {
    fail("the sources hold changes; commit or drop them, so the releases are one commit's code.");
  }
  const build = ["pnpm", "turbo", "run", "build", "--filter", "binference..."];
  if (runCommandShown([...build, "--output-logs=errors-only"], { cwd: root }) !== 0) {
    fail("the build failed; its errors are above.");
  }
  rmSync(folder, { recursive: true, force: true });
  mkdirSync(folder, { recursive: true });
  const workspace = readWorkspace(root);
  const packed = (version: string) =>
    packPackage({ workspace, version, isNightly: true }, "binference", folder).file;
  const files = { from: packed(versions.from), to: packed(versions.to) };
  stageInstallScripts(root, folder);
  const manifest = { versions, files, commit: sources.commit };
  writeFileSync(join(folder, "first-day.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`first-day:smoke: packed ${versions.from} and ${versions.to} into ${folder}.`);
}

// A folder of stand-ins for the OS's service tools: each logs its call to guard.log and fails.
function writeGuard(): string {
  const guard = mkdtempSync(join(tmpdir(), "bnd-guard-"));
  const log = join(guard, "guard.log");
  writeFileSync(log, "");
  for (const tool of ["launchctl", "systemctl", "loginctl"]) {
    const file = join(guard, tool);
    writeFileSync(file, `#!/bin/sh\nprintf '%s %s\\n' "${tool}" "$*" >> '${log}'\nexit 1\n`);
    chmodSync(file, 0o755);
  }
  return guard;
}

// The one-liner as the install guide prints it, installing A, with no Node on PATH; init waits
// for the driver, which times it as a step of its own. The sources' state goes beside its run.
async function installA(folder: string, scratch: string): Promise<void> {
  const manifest = z
    .object({ files: z.object({ from: z.string() }) })
    .parse(JSON.parse(readFileSync(join(folder, "first-day.json"), "utf8")));
  const files = await serveRelease(folder);
  const started = performance.now();
  try {
    const env = {
      BINFERENCE_INSTALL_PACKAGE: `${files.base}/${manifest.files.from}`,
      BINFERENCE_INSTALL_SKIP_INIT: "1",
    };
    const run = await runOneLiner(files.base, scratch, { withNode: false, env });
    const seconds = Math.round((performance.now() - started) / 100) / 10;
    console.log(run.output.trimEnd().replaceAll(/^/gm, "  | "));
    const outcome = { ...run, seconds, sources: sourcesState() };
    writeFileSync(join(scratch, "one-liner.json"), JSON.stringify(outcome));
  } finally {
    await files.close();
  }
}

// The driver's steps, with the machine they ran on, written to reports/first-day/.
function writeReport(stepsFile: string): boolean {
  const written = existsSync(stepsFile) ? readFileSync(stepsFile, "utf8") : "null";
  const steps = reportSchema.safeParse(JSON.parse(written));
  if (!steps.success) {
    console.error("first-day:smoke: the driver wrote no steps; its output is above.");
    return false;
  }
  const total = steps.data.steps.reduce((sum, step) => sum + step.seconds, 0);
  // The Node that ran the smoke; the install runs the pinned Node of the install script.
  const machine = { os: process.platform, arch: process.arch, smokeNode: process.version };
  const report = { ...machine, ...steps.data, totalSeconds: Math.round(total * 10) / 10 };
  const file = join(out, `first-day-${process.platform}.json`);
  writeFileSync(file, `${JSON.stringify(report, null, 2)}\n`);
  for (const step of steps.data.steps) {
    console.log(
      `  ${step.step.padEnd(10)} ${step.seconds.toFixed(1).padStart(6)} s  ${step.outcome}`,
    );
  }
  console.log(`first-day:smoke: ${report.totalSeconds.toFixed(1)} s, Privy ${steps.data.privy}.`);
  console.log(`first-day:smoke: the report is ${file}.`);
  return steps.data.steps.every((step) => step.outcome !== "failed");
}

async function runDay(folder: string, privy: Ask["privy"]): Promise<boolean> {
  const scratch = mkdtempSync(join(tmpdir(), "bnd-"));
  const guard = writeGuard();
  const stepsFile = join(scratch, "steps.json");
  try {
    await installA(folder, scratch);
    const node = ["node", "--conditions=@binference/source", "--import", "tsx", driver];
    const line = [...node, folder, scratch, guard, stepsFile, privy];
    const status = runCommandShown(line, { cwd: root });
    return writeReport(stepsFile) && status === 0;
  } finally {
    for (const path of [scratch, guard]) {
      rmSync(path, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
    }
  }
}

const ask = readArguments();
const folder = ask.packed ?? join(out, "packed");
mkdirSync(out, { recursive: true });
if (ask.packed === undefined) {
  pack(folder);
}
if (!ask.packOnly) {
  const passed = await runDay(folder, ask.privy);
  console.log(`first-day:smoke: ${passed ? "passed" : "failed"}.`);
  process.exitCode = passed ? 0 : 1;
}
