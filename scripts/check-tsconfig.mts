import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import process from "node:process";
import { z } from "zod";

const requiredFlags: Readonly<Record<string, boolean | string>> = {
  strict: true,
  noUncheckedIndexedAccess: true,
  exactOptionalPropertyTypes: true,
  noImplicitOverride: true,
  noImplicitReturns: true,
  noPropertyAccessFromIndexSignature: true,
  noUncheckedSideEffectImports: true,
  verbatimModuleSyntax: true,
  isolatedDeclarations: true,
  erasableSyntaxOnly: true,
  module: "NodeNext",
  moduleResolution: "NodeNext",
  target: "ES2023",
};

// Each of these can switch off part of "strict" on its own.
const strictFamily = [
  "noImplicitAny",
  "noImplicitThis",
  "strictNullChecks",
  "strictFunctionTypes",
  "strictBindCallApply",
  "strictPropertyInitialization",
  "strictBuiltinIteratorReturn",
  "alwaysStrict",
  "useUnknownInCatchVariables",
];

// Scripts never emit declarations; the console bundles with Vite.
const allowedOverrides: Readonly<Record<string, Readonly<Record<string, boolean | string>>>> = {
  "scripts/tsconfig.json": { isolatedDeclarations: false },
  "packages/console/tsconfig.json": { moduleResolution: "Bundler", module: "ESNext" },
};

const tsconfigSchema = z.looseObject({
  extends: z.string().optional(),
  compilerOptions: z.record(z.string(), z.unknown()).optional(),
});

type Tsconfig = z.infer<typeof tsconfigSchema>;

function readTsconfig(repo: string, file: string): Tsconfig {
  try {
    return tsconfigSchema.parse(JSON.parse(readFileSync(join(repo, file), "utf8")));
  } catch (error) {
    throw new Error(`${file} must be plain JSON with an object of compilerOptions.`, {
      cause: error,
    });
  }
}

function baseProblems(repo: string): string[] {
  const options = readTsconfig(repo, "tsconfig.base.json").compilerOptions ?? {};
  return Object.entries(requiredFlags)
    .filter(([flag, value]) => options[flag] !== value)
    .map(([flag, value]) => `tsconfig.base.json must set ${flag} to ${JSON.stringify(value)}.`);
}

function overrideProblems(file: string, options: Readonly<Record<string, unknown>>): string[] {
  const allowed = allowedOverrides[file] ?? {};
  const protectedFlags = [...Object.keys(requiredFlags), ...strictFamily];
  return protectedFlags
    .filter((flag) => flag in options && options[flag] !== allowed[flag])
    .map((flag) => `${file} sets ${flag}; the base flags of tsconfig.base.json hold everywhere.`);
}

function configProblems(repo: string, file: string): string[] {
  const config = readTsconfig(repo, file);
  const folder = dirname(join(repo, file));
  const base = join(repo, "tsconfig.base.json");
  const extendsBase = config.extends !== undefined && resolve(folder, config.extends) === base;
  return [
    ...(extendsBase ? [] : [`${file} must extend ${relative(folder, base)} directly.`]),
    ...overrideProblems(file, config.compilerOptions ?? {}),
  ];
}

function listTsconfigs(repo: string): readonly string[] {
  const nested = ["packages", "plugins"].flatMap((parent) => {
    const root = join(repo, parent);
    if (!existsSync(root)) {
      return [];
    }
    return readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .flatMap((entry) =>
        readdirSync(join(root, entry.name))
          .filter((name) => /^tsconfig.*\.json$/.test(name))
          .map((name) => `${parent}/${entry.name}/${name}`),
      );
  });
  return ["tsconfig.json", "scripts/tsconfig.json", ...nested];
}

const repo = process.cwd();
const files = listTsconfigs(repo);
const problems = [...baseProblems(repo), ...files.flatMap((file) => configProblems(repo, file))];
for (const problem of problems) {
  console.error(`check:tsconfig: ${problem}`);
}
if (problems.length === 0) {
  console.log(`check:tsconfig: ${String(files.length)} tsconfig files keep the base flags.`);
}
process.exitCode = problems.length === 0 ? 0 : 1;
