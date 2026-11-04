import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import { parseArgs } from "node:util";
import { oneByOne } from "./bridge-chains/one-by-one.mjs";
import { type OneLinerRun, runOneLiner, serveRelease, versionOf } from "./install/one-liner.mjs";
import { readPackedManifest } from "./release/release-plan.mjs";

// The install one-liner's smoke test (decision 0357) on the folder a release:dry run wrote, which
// holds the packed tarballs and the staged install scripts. A file server on 127.0.0.1 stands in
// for binference.io. Each case runs the one-liner as the install guide prints it, with a home and
// a state folder of its own:
//
//   wrong hash    no Node on PATH, and a Node mirror that serves the wrong bytes: it stops with
//                 the SHA-256 and unpacks nothing
//   this Node     this Node 26 on PATH: no Node download; the packed binference installs, its
//                 launcher prints the version, and init --yes starts
//   fresh Node    with --fresh-node, no Node on PATH: the pinned Node from nodejs.org, checked
//                 by its pin, then the same install
//
// init --yes gets no answers, so it stops at the first one with its refusal line and exit code,
// which the installer must pass on: that proves the installed binference ran init. It never runs
// in pnpm check, and touches nothing outside its own temporary folder.

const usage =
  "Usage: pnpm install:smoke <folder> [--fresh-node], the folder a release:dry run wrote.";
const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: { "fresh-node": { type: "boolean" } },
});
const [folder] = positionals;
if (folder === undefined || positionals.length > 1) {
  console.error(usage);
  process.exit(1);
}

// What a case expects of a run, given the paths the loopback was asked for and the run's folder;
// each line names what went wrong.
type Check = (run: OneLinerRun, asked: readonly string[], scratch: string) => readonly string[];

// The exit code of init refusing an answer nobody gave, which the installer ends with.
const initRefusedCode = 1;

function versionProblems(command: string | undefined, version: string, scratch: string) {
  if (command === undefined) {
    return [];
  }
  const printed = versionOf(command, scratch);
  return printed.includes(version)
    ? []
    : [`${command} --version printed ${printed}, not ${version}`];
}

function startsInit(version: string): Check {
  return (run, asked, scratch) => [
    ...(run.command === undefined ? ["it never said binference is installed"] : []),
    ...(run.status === initRefusedCode
      ? []
      : [`it ended with ${String(run.status)}, not init's ${String(initRefusedCode)}`]),
    ...(/^binference init needs --[a-z-]+\. Give that flag/m.test(run.output)
      ? []
      : ["init --yes never printed its refusal"]),
    ...(run.output.includes("init stopped") ? [] : ["it never said init stopped"]),
    // The launcher's folder is not on the scratch PATH, so the line must print.
    ...(/export PATH=|Set-ItemProperty 'HKCU:\\Environment'/.test(run.output)
      ? []
      : ["it printed no PATH line"]),
    ...(asked.some((path) => path.startsWith("/v")) ? ["it asked the loopback for Node"] : []),
    ...versionProblems(run.command, version, scratch),
  ];
}

const stopsAtHash: Check = (run) => [
  ...(run.status === 1 ? [] : [`it ended with ${String(run.status)}, not 1`]),
  ...(run.output.includes("SHA-256") && run.output.includes("nothing was installed")
    ? []
    : ["it never named the SHA-256 that differs"]),
  ...(run.command === undefined ? [] : ["it installed binference"]),
];

interface SmokeCase {
  readonly name: string;
  readonly withNode: boolean;
  /** The Node mirror is the loopback, which serves the wrong bytes; else nodejs.org. */
  readonly loopbackMirror: boolean;
  readonly check: Check;
}

const manifest = readPackedManifest(folder);
const binference = manifest.packages.find((item) => item.name === "binference");
if (binference === undefined) {
  console.error(`install:smoke: ${folder} holds no packed binference.`);
  process.exit(1);
}
const cases: readonly SmokeCase[] = [
  {
    name: "a wrong Node hash stops before unpacking",
    withNode: false,
    loopbackMirror: true,
    check: stopsAtHash,
  },
  {
    name: "this Node 26 is kept and the packed binference starts init",
    withNode: true,
    loopbackMirror: true,
    check: startsInit(manifest.version),
  },
  ...(values["fresh-node"] === true
    ? [
        {
          name: "the pinned Node comes from nodejs.org and the packed binference starts init",
          withNode: false,
          loopbackMirror: false,
          check: startsInit(manifest.version),
        },
      ]
    : []),
];

async function runCase(release: string, item: SmokeCase): Promise<boolean> {
  const scratch = mkdtempSync(join(tmpdir(), "binference-install-smoke-"));
  const files = await serveRelease(release);
  const started = performance.now();
  try {
    const env = {
      BINFERENCE_INSTALL_PACKAGE: `${files.base}/${binference?.file ?? ""}`,
      BINFERENCE_INSTALL_YES: "1",
      ...(item.loopbackMirror ? { BINFERENCE_NODE_MIRROR: files.base } : {}),
    };
    const run = await runOneLiner(files.base, scratch, { withNode: item.withNode, env });
    const problems = item.check(run, files.requests(), scratch);
    const seconds = ((performance.now() - started) / 1000).toFixed(1);
    const verdict = problems.length === 0 ? "ok  " : `FAIL: ${problems.join("; ")}`;
    const shown = run.output.trimEnd().replaceAll(/^/gm, "  | ");
    console.log(`${verdict}  ${item.name} (${seconds} s)\n${shown}`);
    return problems.length === 0;
  } finally {
    await files.close();
    rmSync(scratch, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  }
}

const results = await oneByOne(cases, async (item) => runCase(folder, item));
const passed = results.filter(Boolean).length;
console.log(`install:smoke: ${String(passed)} of ${String(cases.length)} cases passed.`);
process.exitCode = passed === cases.length ? 0 : 1;
