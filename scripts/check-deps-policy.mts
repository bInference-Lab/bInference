import { readFileSync } from "node:fs";
import { join } from "node:path";
import process from "node:process";
import { parse } from "yaml";
import { z } from "zod";
import { listRepoFiles } from "./repo-files.mjs";

const workspaceFile = "pnpm-workspace.yaml";
const requiredSettings: Readonly<Record<string, unknown>> = {
  minimumReleaseAge: 10080,
  minimumReleaseAgeStrict: true,
  blockExoticSubdeps: true,
  engineStrict: true,
  strictDepBuilds: true,
  savePrefix: "",
  catalogMode: "strict",
};
const exactVersion = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const internalReference = /^(?:catalog:[\w-]*|workspace:\*)$/;
const dependencyFields = [
  "dependencies",
  "devDependencies",
  "peerDependencies",
  "optionalDependencies",
];

const workspaceSchema = z.looseObject({
  catalog: z.record(z.string(), z.string()).default({}),
  allowBuilds: z.record(z.string(), z.boolean()).optional(),
  minimumReleaseAgeExclude: z.array(z.string()).default([]),
});

function settingProblems(settings: Readonly<Record<string, unknown>>): string[] {
  return [
    ...Object.entries(requiredSettings)
      .filter(([key, value]) => settings[key] !== value)
      .map(([key, value]) => `${workspaceFile} must set ${key}: ${JSON.stringify(value)}.`),
    ...(typeof settings["allowBuilds"] === "object"
      ? []
      : [`${workspaceFile} must list reviewed install scripts under allowBuilds.`]),
  ];
}

function catalogProblems(catalog: Readonly<Record<string, string>>): string[] {
  return Object.entries(catalog)
    .filter(([, version]) => !exactVersion.test(version))
    .map(([name, version]) => `The catalog pins ${name} to ${version}; write an exact version.`);
}

function manifestProblems(root: string, file: string): string[] {
  const manifest = z
    .record(z.string(), z.unknown())
    .parse(JSON.parse(readFileSync(join(root, file), "utf8")));
  return dependencyFields.flatMap((field) => {
    const entries = z.record(z.string(), z.string()).safeParse(manifest[field] ?? {});
    if (!entries.success) {
      return [`${file} ${field} must map names to versions.`];
    }
    return Object.entries(entries.data)
      .filter(([, version]) => !internalReference.test(version))
      .map(([name, version]) => `${file} asks for ${name}@${version}; write "catalog:" instead.`);
  });
}

interface Exclusion {
  readonly entry: string;
  readonly comment: string;
}

// Each exclusion from the release-age rule and each ignored advisory carries a comment above
// it: the reason, then "remove after YYYY-MM-DD".
function readExclusions(text: string, key: string): readonly Exclusion[] {
  const lines = text.split("\n");
  const start = lines.findIndex((line) => line.trim() === `${key}:`);
  const indent = start === -1 ? 0 : (lines[start] ?? "").search(/\S/);
  const block = start === -1 ? [] : lines.slice(start + 1);
  const end = block.findIndex((line) => line.trim().length > 0 && line.search(/\S/) <= indent);
  const exclusions: Exclusion[] = [];
  let comment = "";
  for (const line of (end === -1 ? block : block.slice(0, end)).map((item) => item.trim())) {
    const entry = /^- (.+)$/.exec(line)?.[1];
    if (line.startsWith("#")) {
      comment = `${comment} ${line.slice(1)}`;
    } else if (entry !== undefined) {
      exclusions.push({ entry, comment: comment.trim() });
      comment = "";
    }
  }
  return exclusions;
}

function exclusionProblem(exclusion: Exclusion, today: string): string | undefined {
  const date = /remove after (\d{4}-\d{2}-\d{2})/.exec(exclusion.comment)?.[1];
  const reason = exclusion.comment.replace(/;?\s*remove after.*$/, "").trim();
  if (date === undefined || reason.length === 0) {
    return `The exclusion ${exclusion.entry} needs a comment: its reason, then "remove after <date>".`;
  }
  return date < today
    ? `The exclusion ${exclusion.entry} was due for removal on ${date}.`
    : undefined;
}

const root = process.cwd();
const text = readFileSync(join(root, workspaceFile), "utf8");
const settings = z.record(z.string(), z.unknown()).parse(parse(text));
const workspace = workspaceSchema.parse(settings);
const npmrc = readFileSync(join(root, ".npmrc"), "utf8").split("\n");
const today = new Date().toISOString().slice(0, 10);
const manifests = listRepoFiles(root).filter((file) => /(?:^|\/)package\.json$/.test(file));
const problems = [
  ...settingProblems(settings),
  ...(npmrc.includes("min-release-age=7") ? [] : [".npmrc must set min-release-age=7."]),
  ...catalogProblems(workspace.catalog),
  ...manifests.flatMap((file) => manifestProblems(root, file)),
  ...["minimumReleaseAgeExclude", "ignoreGhsas"]
    .flatMap((key) => readExclusions(text, key))
    .map((exclusion) => exclusionProblem(exclusion, today))
    .filter((problem) => problem !== undefined),
];
for (const problem of problems) {
  console.error(`check:deps-policy: ${problem}`);
}
if (problems.length === 0) {
  console.log(
    `check:deps-policy: ${String(manifests.length)} manifests take exact versions from the catalog.`,
  );
}
process.exitCode = problems.length === 0 ? 0 : 1;
