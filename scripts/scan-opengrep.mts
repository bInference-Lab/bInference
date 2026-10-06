import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import process from "node:process";
import { z } from "zod";
import { listRepoFiles } from "./repo-files.mjs";
import { runCommand } from "./run-command.mjs";

const roots = ["packages/", "plugins/", "scripts/", "config/"];
const code = /\.(?:[cm]?ts|tsx|[cm]?js|jsx)$/;
// OpenGrep 1.30 skips .mts and .cts files, so they are scanned under a .ts name.
const unread = /\.[cm]ts$/;
const rules = resolve("config/opengrep/rules.yml");
const ruleIds = [
  "binference.child-process-shell",
  "binference.secret-on-command-line",
  "binference.secret-in-url",
];

const reportSchema = z.looseObject({
  results: z.array(
    z.looseObject({
      check_id: z.string(),
      path: z.string(),
      start: z.looseObject({ line: z.number() }),
      extra: z.looseObject({ message: z.string() }),
    }),
  ),
  errors: z.array(z.looseObject({ level: z.string().optional(), message: z.string().optional() })),
});

interface Finding {
  readonly rule: string;
  readonly file: string;
  readonly line: number;
  readonly message: string;
}

interface Scan {
  readonly findings: readonly Finding[];
  readonly problems: readonly string[];
  readonly warnings: readonly string[];
}

function stage(files: readonly string[], from: string, into: string): ReadonlyMap<string, string> {
  return new Map(
    files.map((original) => {
      const scanned = original.replace(unread, ".ts");
      mkdirSync(dirname(join(into, scanned)), { recursive: true });
      copyFileSync(join(from, original), join(into, scanned));
      return [scanned, original];
    }),
  );
}

// The rule id carries the config file's path as a prefix; findings are named by our own id.
function ruleOf(checkId: string): string {
  return ruleIds.find((id) => checkId.endsWith(id)) ?? checkId;
}

// Messages name the scanned copy; readers need the file as it is in the repo.
function renamed(text: string, originals: ReadonlyMap<string, string>): string {
  return [...originals].reduce(
    (out, [scanned, original]) => out.replaceAll(scanned, original),
    text,
  );
}

function describe(error: { readonly message?: string | undefined }): string {
  return error.message ?? "no message";
}

function scan(folder: string, originals: ReadonlyMap<string, string>): Scan {
  const result = runCommand(["opengrep", "scan", "--config", rules, "--json", "."], {
    cwd: folder,
  });
  const json = result.output.slice(result.output.indexOf("{"), result.output.lastIndexOf("}") + 1);
  const parsed = reportSchema.safeParse(json.length > 0 ? JSON.parse(json) : undefined);
  if (result.status !== 0 || !parsed.success) {
    const problem = `opengrep exited ${String(result.status)}:\n${result.output}`;
    return { findings: [], problems: [problem], warnings: [] };
  }
  const findings = parsed.data.results.map((hit) => ({
    rule: ruleOf(hit.check_id),
    file: originals.get(hit.path) ?? hit.path,
    line: hit.start.line,
    message: hit.extra.message,
  }));
  // A parser warning means part of one file went unread; it is shown, as OpenGrep's --error does.
  const errors = parsed.data.errors;
  const problems = errors.filter((error) => error.level !== "warn").map(describe);
  const warnings = errors
    .filter((error) => error.level === "warn")
    .map((error) => renamed(describe(error), originals));
  return { findings, problems, warnings };
}

function scanFiles(files: readonly string[], from: string): Scan {
  const folder = mkdtempSync(join(tmpdir(), "opengrep-"));
  try {
    return scan(folder, stage(files, from, folder));
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
}

function scanRepo(): number {
  const repo = process.cwd();
  const files = listRepoFiles(repo).filter(
    (file) => roots.some((root) => file.startsWith(root)) && code.test(file),
  );
  const { findings, problems, warnings } = scanFiles(files, repo);
  for (const warning of warnings) {
    console.warn(`scan-opengrep: warning: ${warning}`);
  }
  for (const finding of findings) {
    console.error(`${finding.file}:${String(finding.line)}: ${finding.rule}: ${finding.message}`);
  }
  for (const problem of problems) {
    console.error(problem);
  }
  if (findings.length === 0 && problems.length === 0) {
    console.log(`scan-opengrep: ${String(files.length)} files, no findings.`);
  }
  return findings.length === 0 && problems.length === 0 ? 0 : 1;
}

const planted = [
  'import { spawn } from "node:child_process";',
  'const apiToken = "planted";',
  'spawn("ls", ["-la"], { shell: true });',
  'spawn("curl", ["-H", apiToken]);',
  // Split so this file's own text never matches the secret-in-URL rule.
  ["await fetch(`https://example.com/?key=$", "{apiToken}`);"].join(""),
].join("\n");

// Proves every rule still fires, on an .mts file, so a scanner that reads nothing cannot pass.
function selfTest(): number {
  const source = mkdtempSync(join(tmpdir(), "opengrep-planted-"));
  try {
    writeFileSync(join(source, "planted.mts"), planted);
    const { findings, problems } = scanFiles(["planted.mts"], source);
    const missed = ruleIds.filter((id) => !findings.some((finding) => finding.rule === id));
    for (const message of [...problems, ...missed.map((id) => `${id} did not fire.`)]) {
      console.error(`scan-opengrep: ${message}`);
    }
    if (missed.length === 0 && problems.length === 0) {
      console.log(`scan-opengrep: all ${String(ruleIds.length)} rules fired on an .mts file.`);
    }
    return missed.length === 0 && problems.length === 0 ? 0 : 1;
  } finally {
    rmSync(source, { recursive: true, force: true });
  }
}

process.exitCode = process.argv.includes("--self-test") ? selfTest() : scanRepo();
