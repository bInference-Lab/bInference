import { existsSync, readFileSync } from "node:fs";
import { basename, dirname, join, posix } from "node:path";

/** A layout rule broken by a file or folder. */
export interface LayoutProblem {
  readonly rule: string;
  readonly message: string;
}

/** The repo as the layout rules see it. */
export interface RepoView {
  readonly root: string;
  /** Tracked and new files, relative paths with forward slashes. */
  readonly files: readonly string[];
}

function problem(rule: string, message: string): LayoutProblem {
  return { rule, message };
}

function read(repo: RepoView, file: string): string {
  return readFileSync(join(repo.root, file), "utf8");
}

const kebabCase = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const bannedNames = /^(?:utils|helpers|common|misc|shared)(?:\.[a-z]+)+$/;

/** Folders are kebab-case; no file is a grab bag such as utils.ts. */
export function namingProblems(repo: RepoView): LayoutProblem[] {
  const folders = new Set(repo.files.flatMap((file) => dirname(file).split("/").filter(Boolean)));
  return [
    ...[...folders]
      .filter((folder) => folder !== "." && !folder.startsWith(".") && !kebabCase.test(folder))
      .map((folder) => problem("folder-name", `Folder ${folder} is not kebab-case.`)),
    ...repo.files
      .filter((file) => bannedNames.test(basename(file)))
      .map((file) => problem("file-name", `${file}: name the file after its one concept.`)),
  ];
}

function packageFolders(repo: RepoView): readonly string[] {
  const manifests = repo.files.filter((file) =>
    /^(?:packages|plugins)\/[^/]+\/package\.json$/.test(file),
  );
  return manifests.map((file) => dirname(file));
}

function readmeProblems(repo: RepoView, folder: string): LayoutProblem[] {
  const file = `${folder}/README.md`;
  if (!existsSync(join(repo.root, file))) {
    return [];
  }
  const text = read(repo, file);
  const missing = ["## Purpose", "## API", "## Example"].filter(
    (heading) => !text.split("\n").includes(heading),
  );
  return [
    ...missing.map((heading) => problem("readme", `${file} needs a "${heading}" section.`)),
    ...(/^```/m.test(text) ? [] : [problem("readme", `${file} needs an example code block.`)]),
  ];
}

/** Each package has AGENTS.md, CLAUDE.md and a README with purpose, API and an example. */
export function packageProblems(repo: RepoView): LayoutProblem[] {
  return packageFolders(repo).flatMap((folder) =>
    ["AGENTS.md", "CLAUDE.md", "README.md"]
      .filter((name) => !existsSync(join(repo.root, folder, name)))
      .map((name) => problem("package-files", `${folder} has no ${name}.`))
      .concat(readmeProblems(repo, folder)),
  );
}

/** CLAUDE.md files import AGENTS.md and hold nothing else; the root one may add notes. */
export function agentFileProblems(repo: RepoView): LayoutProblem[] {
  const claudeFiles = repo.files.filter((file) => basename(file) === "CLAUDE.md");
  const agentFiles = repo.files.filter((file) => basename(file) === "AGENTS.md");
  return [
    ...claudeFiles
      .filter((file) => {
        const text = read(repo, file);
        return file === "CLAUDE.md"
          ? !text.startsWith("@AGENTS.md\n")
          : text.trim() !== "@AGENTS.md";
      })
      .map((file) => problem("claude-md", `${file} must hold only @AGENTS.md.`)),
    ...agentFiles
      .filter((file) => !existsSync(join(repo.root, dirname(file), "CLAUDE.md")))
      .map((file) => problem("claude-md", `${file} needs a CLAUDE.md beside it.`)),
  ];
}

const markdownLink = /\[[^\]]*\]\(([^)\s]+)\)/g;

/** The root AGENTS.md stays under 200 lines, and every link in an AGENTS.md resolves. */
export function agentRuleProblems(repo: RepoView): LayoutProblem[] {
  const agentFiles = repo.files.filter((file) => basename(file) === "AGENTS.md");
  const size = read(repo, "AGENTS.md").split("\n").length;
  const links = agentFiles.flatMap((file) =>
    [...read(repo, file).matchAll(markdownLink)]
      .map((match) => match[1] ?? "")
      .filter((target) => !/^(?:[a-z]+:|#)/.test(target))
      .filter((target) => !existsSync(join(repo.root, dirname(file), target.split("#")[0] ?? "")))
      .map((target) => problem("agents-link", `${file} links to ${target}, which does not exist.`)),
  );
  return [
    ...(size < 200
      ? []
      : [problem("agents-size", `AGENTS.md has ${String(size)} lines; keep it under 200.`)]),
    ...links,
  ];
}

const shellFile = /\.(?:sh|bash|ps1|bat|cmd)$/i;

/** Repo scripts are TypeScript run by Node; no shell files and no shell in package scripts. */
export function shellProblems(repo: RepoView): LayoutProblem[] {
  const manifests = repo.files.filter((file) => basename(file) === "package.json");
  return [
    ...repo.files
      .filter((file) => shellFile.test(file))
      .map((file) => problem("shell-script", `${file}: write repo scripts as .mts files.`)),
    ...manifests.flatMap((file) =>
      Object.entries(scriptsOf(read(repo, file)))
        .filter(([, command]) => /\bbash\b|\bsh -c\b/.test(command))
        .map(([name]) => problem("shell-script", `${file} script ${name} calls a shell.`)),
    ),
  ];
}

function scriptsOf(manifest: string): Readonly<Record<string, string>> {
  const parsed: unknown = JSON.parse(manifest);
  if (typeof parsed !== "object" || parsed === null || !("scripts" in parsed)) {
    return {};
  }
  const scripts: unknown = parsed.scripts;
  if (typeof scripts !== "object" || scripts === null) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(scripts).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  );
}

/** Tests sit beside the code in a package's src folder, and nowhere else. */
export function testProblems(repo: RepoView): LayoutProblem[] {
  return repo.files
    .filter((file) => /\.(?:test|spec)\.[cm]?[jt]sx?$/.test(file))
    .filter((file) => !/^(?:packages|plugins)\/[^/]+\/src\//.test(file))
    .map((file) => problem("test-location", `${file}: tests live beside the code in src/.`));
}

const propertyModule =
  /^(?:packages|plugins)\/[^/]+\/src\/(?:.*\/)?(?:policy\/[^/]+|[^/]*amount[^/]*)\.ts$/;

/** Policy and amount modules carry a property test beside them. */
export function propertyTestProblems(repo: RepoView): LayoutProblem[] {
  return repo.files
    .filter((file) => propertyModule.test(file) && !/\.test\.ts$|\/index\.ts$/.test(file))
    .filter((file) => !repo.files.includes(file.replace(/\.ts$/, ".property.test.ts")))
    .map((file) =>
      problem("property-test", `${file} needs ${posix.basename(file, ".ts")}.property.test.ts.`),
    );
}
