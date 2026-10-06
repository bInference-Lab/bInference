import { existsSync, readFileSync } from "node:fs";
import { join, posix } from "node:path";
import { hasDocSentence } from "./doc-block.mjs";
import { scanExports, type ModuleExports } from "./module-exports.mjs";

/** An export a package's entries reach that carries no TSDoc sentence, or a broken re-export. */
export interface TsdocProblem {
  readonly where: string;
  readonly message: string;
}

interface Walk {
  readonly root: string;
  readonly entry: string;
  readonly seen: Set<string>;
  readonly modules: Map<
    string,
    { readonly lines: readonly string[]; readonly exports: ModuleExports }
  >;
}

// A relative specifier names a source file; one into another package is that package's to check.
function resolve(root: string, from: string, specifier: string): string | undefined {
  if (!specifier.startsWith(".")) {
    return undefined;
  }
  const base = posix.join(posix.dirname(from), specifier);
  const candidates = [
    base.replace(/\.js$/, ".ts").replace(/\.mjs$/, ".mts"),
    `${base}.ts`,
    posix.join(base, "index.ts"),
  ];
  return candidates.find((file) => /\.m?ts$/.test(file) && existsSync(join(root, file)));
}

function load(
  walk: Walk,
  file: string,
): { readonly lines: readonly string[]; readonly exports: ModuleExports } {
  const known = walk.modules.get(file);
  if (known !== undefined) {
    return known;
  }
  const text = readFileSync(join(walk.root, file), "utf8");
  const loaded = { lines: text.split("\n"), exports: scanExports(text) };
  walk.modules.set(file, loaded);
  return loaded;
}

interface Request {
  readonly file: string;
  readonly name: string;
}

function followModule(
  walk: Walk,
  request: Request,
  source: { specifier: string; name: string; line: number },
): TsdocProblem[] {
  const target = resolve(walk.root, request.file, source.specifier);
  if (target === undefined) {
    return source.specifier.startsWith(".")
      ? [
          {
            where: `${request.file}:${String(source.line + 1)}`,
            message: `${source.specifier} does not resolve to a source file.`,
          },
        ]
      : [];
  }
  return checkName(walk, { file: target, name: source.name });
}

function fromStars(
  walk: Walk,
  request: Request,
  exports: ModuleExports,
): TsdocProblem[] | undefined {
  for (const starred of exports.stars) {
    const target = resolve(walk.root, request.file, starred.specifier);
    if (target !== undefined && exportedNames(walk, target).includes(request.name)) {
      return checkName(walk, { file: target, name: request.name });
    }
  }
  return undefined;
}

/** Checks one exported name of a module, following re-exports to its declaration. */
function checkName(walk: Walk, request: Request): TsdocProblem[] {
  const key = `${request.file}#${request.name}`;
  if (walk.seen.has(key)) {
    return [];
  }
  walk.seen.add(key);
  const { lines, exports } = load(walk, request.file);
  const source = exports.names.get(request.name);
  if (source?.kind === "module") {
    return followModule(walk, request, source);
  }
  if (source?.kind === "here") {
    return hasDocSentence(lines, source.line)
      ? []
      : [
          {
            where: `${request.file}:${String(source.line + 1)}`,
            message: `${request.name} has no TSDoc sentence (reached from ${walk.entry}).`,
          },
        ];
  }
  return (
    fromStars(walk, request, exports) ?? [
      { where: request.file, message: `${request.name} is not exported here.` },
    ]
  );
}

/** Every name a module exports, its star re-exports included. */
function exportedNames(walk: Walk, file: string, visited: Set<string> = new Set()): string[] {
  if (visited.has(file)) {
    return [];
  }
  visited.add(file);
  const { exports } = load(walk, file);
  const starred = exports.stars.flatMap((item) => {
    const target = resolve(walk.root, file, item.specifier);
    return target === undefined ? [] : exportedNames(walk, target, visited);
  });
  return [...new Set([...exports.names.keys(), ...starred])];
}

/** The problems of every export an entry file reaches. */
export function entryProblems(root: string, entry: string): TsdocProblem[] {
  const walk: Walk = { root, entry, seen: new Set(), modules: new Map() };
  const unresolved = load(walk, entry).exports.stars.filter(
    (item) => item.specifier.startsWith(".") && resolve(root, entry, item.specifier) === undefined,
  );
  return [
    ...unresolved.map((item) => ({
      where: `${entry}:${String(item.line + 1)}`,
      message: `${item.specifier} does not resolve to a source file.`,
    })),
    ...exportedNames(walk, entry).flatMap((name) => checkName(walk, { file: entry, name })),
  ];
}
