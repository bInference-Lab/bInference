/**
 * A package name no real package takes. Cases plant it when only the package's tier matters, so
 * they never overwrite a real package that other packages import.
 */
export const sampleKey = "sample";

/** What a planted package holds besides its source files. */
export interface FixtureOptions {
  readonly dependencies?: Readonly<Record<string, string>>;
  readonly tsconfig?: Readonly<Record<string, unknown>>;
  /** Package-root files to leave out, such as AGENTS.md. */
  readonly omit?: readonly string[];
}

const readme = [
  "# Fixture",
  "",
  "## Purpose",
  "",
  "A package planted by the gate checks.",
  "",
  "## API",
  "",
  "`ready`.",
  "",
  "## Example",
  "",
  "```ts",
  "ready;",
  "```",
  "",
].join("\n");

function manifest(key: string, options: FixtureOptions): string {
  const content = {
    name: `@binference/${key}`,
    version: "0.0.0",
    private: true,
    type: "module",
    exports: { ".": { "@binference/source": "./src/index.ts" } },
    ...(options.dependencies === undefined ? {} : { dependencies: options.dependencies }),
  };
  return `${JSON.stringify(content, null, 2)}\n`;
}

/**
 * The files of a package under packages/<key>, ready to plant in the sandbox. Source files are
 * named relative to the package's src folder; src/index.ts exists unless the caller writes one.
 */
export function fixturePackage(
  key: string,
  sources: Readonly<Record<string, string>>,
  options: FixtureOptions = {},
): Record<string, string> {
  const root = `packages/${key}`;
  const tsconfig = options.tsconfig ?? {
    extends: "../../tsconfig.base.json",
    include: ["src"],
  };
  const rootFiles: Record<string, string> = {
    "package.json": manifest(key, options),
    "tsconfig.json": `${JSON.stringify(tsconfig, null, 2)}\n`,
    "AGENTS.md": "# Fixture\n\nA package planted by the gate checks.\n",
    "CLAUDE.md": "@AGENTS.md\n",
    "README.md": readme,
  };
  const files: Record<string, string> = {
    [`${root}/src/index.ts`]:
      "/** Marks the package as present. */\nexport const ready: number = 1;\n",
  };
  for (const [file, content] of Object.entries(rootFiles)) {
    if (!(options.omit ?? []).includes(file)) {
      files[`${root}/${file}`] = content;
    }
  }
  for (const [file, content] of Object.entries(sources)) {
    files[`${root}/src/${file}`] = content;
  }
  return files;
}
