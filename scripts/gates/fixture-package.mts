/** What a planted package holds besides its source files. */
export interface FixtureOptions {
  readonly dependencies?: Readonly<Record<string, string>>;
  readonly tsconfig?: Readonly<Record<string, unknown>>;
}

function manifest(key: string, options: FixtureOptions): string {
  const content = {
    name: key === "cli" ? "binference" : `@binference/${key}`,
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
  const files: Record<string, string> = {
    [`${root}/package.json`]: manifest(key, options),
    [`${root}/tsconfig.json`]: `${JSON.stringify(tsconfig, null, 2)}\n`,
    [`${root}/src/index.ts`]:
      "/** Marks the package as present. */\nexport const ready: number = 1;\n",
  };
  for (const [file, content] of Object.entries(sources)) {
    files[`${root}/src/${file}`] = content;
  }
  return files;
}
