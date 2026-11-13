import type { PackageGraph, PackageRow } from "./graph.mjs";

/** An entry of eslint/no-restricted-imports "paths". */
interface RestrictedPath {
  readonly name: string;
  readonly importNames?: readonly string[];
  readonly message: string;
}

/** An entry of eslint/no-restricted-imports "patterns". */
interface RestrictedPattern {
  readonly regex?: string;
  readonly group?: readonly string[];
  readonly message: string;
}

/** An entry of eslint/no-restricted-globals. */
interface RestrictedGlobal {
  readonly name: string;
  readonly message: string;
}

/** An entry of eslint/no-restricted-properties. */
interface RestrictedProperty {
  readonly object?: string;
  readonly property: string;
  readonly message: string;
}

/** Everything a package may not import or touch, before it becomes Oxlint rules. */
export interface Restrictions {
  readonly paths: readonly RestrictedPath[];
  readonly patterns: readonly RestrictedPattern[];
  readonly globals: readonly RestrictedGlobal[];
  readonly properties: readonly RestrictedProperty[];
}

const pureText = "A pure package does no I/O; take a port instead.";
const clockText = "Read time and randomness through the Clock and Random ports.";
const moneyText = "Money is bigint in base units; never a number.";
const displayText = "Format for people in i18n, the one formatter.";
const httpText = "Outbound HTTP goes through the Http port.";

function pathRule(name: string, message: string, importNames?: readonly string[]): RestrictedPath {
  return importNames === undefined ? { name, message } : { name, importNames, message };
}

function nodePaths(row: PackageRow): readonly RestrictedPath[] {
  return [
    pathRule("node:vm", "No node:vm outside the plugin sandbox."),
    pathRule("node:child_process", "Run child processes through execa with an argument array."),
    pathRule("execa", "Pass an argument array; no command strings.", [
      "execaCommand",
      "execaCommandSync",
      "$",
    ]),
    pathRule("node:https", httpText),
    pathRule("undici", httpText),
    ...(row.httpListener === true ? [] : [pathRule("node:http", httpText)]),
    ...(row.fileSystem === true
      ? []
      : [
          pathRule("node:fs", "Open files through the platform package."),
          pathRule("node:fs/promises", "Open files through the platform package."),
        ]),
    ...(row.osLayer === true
      ? []
      : [
          pathRule("node:os", "Only the platform package branches on the OS.", [
            "platform",
            "type",
          ]),
        ]),
    ...(row.compositionRoot === true ? [] : [pathRule("tslog", "Log through the Logger port.")]),
    ...(row.browser === true ? [pathRule("zod", "Import zod/mini in the browser.")] : []),
  ];
}

function purePaths(row: PackageRow): readonly RestrictedPath[] {
  if (row.pure !== true) {
    return [];
  }
  return [
    ...["node:fs", "node:fs/promises", "node:net", "node:sqlite"].map((name) =>
      pathRule(name, pureText),
    ),
    pathRule("node:crypto", clockText, [
      "randomUUID",
      "randomBytes",
      "randomInt",
      "getRandomValues",
    ]),
  ];
}

function uniqueByName<T extends { readonly name: string }>(items: readonly T[]): readonly T[] {
  const byName = new Map<string, T>();
  for (const item of items) {
    if (!byName.has(item.name)) {
      byName.set(item.name, item);
    }
  }
  return [...byName.values()];
}

function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
}

function workspaceNames(graph: PackageGraph): ReadonlyMap<string, string> {
  return new Map(
    Object.entries(graph.packages).map(([key, row]) => [key, row.name ?? `${graph.scope}/${key}`]),
  );
}

function knownLibraries(graph: PackageGraph): readonly string[] {
  const rows = [...Object.values(graph.packages), graph.plugins];
  const keys = new Set(Object.keys(graph.packages));
  const all = rows.flatMap((row) => row.imports).filter((name) => name !== "*" && !keys.has(name));
  return [...new Set(all)].toSorted();
}

interface ScopeOptions {
  readonly key: string;
  readonly row: PackageRow;
  readonly exempt: readonly string[];
  readonly anyThirdParty: boolean;
  /** The browser packages that load these files; none for a package or folder only Node runs. */
  readonly loadedBy: readonly string[];
}

function graphPatterns(graph: PackageGraph, options: ScopeOptions): readonly RestrictedPattern[] {
  if (options.row.imports.includes("*")) {
    return [];
  }
  const allowed = new Set([...options.row.imports, ...graph.allowEverywhere]);
  const names = workspaceNames(graph);
  const blocked = [...names]
    .filter(([key]) => key !== options.key && !allowed.has(key))
    .map(([, name]) => escapeRegex(name));
  const limited = Object.keys(options.row.only ?? {}).filter(
    (name) => !options.exempt.includes(name),
  );
  const libraries = options.anyThirdParty
    ? limited
    : [...knownLibraries(graph).filter((name) => !allowed.has(name)), ...limited];
  const message = `See the ${options.key} row of config/package-graph.json for what it may import.`;
  return [
    ...(blocked.length === 0 ? [] : [{ regex: `^(?:${blocked.join("|")})(?:/|$)`, message }]),
    ...(libraries.length === 0
      ? []
      : [{ group: libraries.flatMap((name) => [name, `${name}/*`]), message }]),
  ];
}

const layoutPatterns = (scope: string): readonly RestrictedPattern[] => [
  { regex: `^${escapeRegex(scope)}/[^/]+/src/`, message: "Import a package through its exports." },
  { regex: "^(?:\\.\\./){2,}", message: "Import another package by its name, not by a path." },
];

// Node's globals a browser lacks, each with what to use instead.
const nodeOnlyGlobals: readonly (readonly [name: string, instead: string])[] = [
  ["Buffer", "use Uint8Array, TextEncoder or atob"],
  ["process", "take the value through a port"],
  ["setImmediate", "use queueMicrotask or setTimeout"],
  ["__dirname", "take the path through a port"],
  ["__filename", "take the path through a port"],
  ["global", "use globalThis"],
];

function loadersText(loadedBy: readonly string[]): string {
  const verb = loadedBy.length === 1 ? "bundles" : "bundle";
  return `The ${loadedBy.join(" and ")} ${verb} this package, and a browser has no`;
}

function browserGlobals(loadedBy: readonly string[]): readonly RestrictedGlobal[] {
  if (loadedBy.length === 0) {
    return [];
  }
  return nodeOnlyGlobals.map(([name, instead]) => ({
    name,
    message: `${loadersText(loadedBy)} ${name}: ${instead}.`,
  }));
}

function browserPatterns(loadedBy: readonly string[]): readonly RestrictedPattern[] {
  if (loadedBy.length === 0) {
    return [];
  }
  const instead = "use a web API, or take the work through a port";
  return [{ regex: "^node:", message: `${loadersText(loadedBy)} node: modules; ${instead}.` }];
}

// A pure package a browser loads restricts process once, with the browser's reason.
function globalsFor(row: PackageRow, loadedBy: readonly string[]): readonly RestrictedGlobal[] {
  const browser = browserGlobals(loadedBy);
  return uniqueByName([
    { name: "fetch", message: httpText },
    ...browser.filter((item) => item.name === "process"),
    ...(row.pure === true ? [{ name: "process", message: "Receive typed values instead." }] : []),
    ...(row.money === true
      ? ["Number", "parseFloat", "parseInt"].map((name) => ({ name, message: moneyText }))
      : []),
    ...(row.formatsDisplay === true ? [] : [{ name: "Intl", message: displayText }]),
    ...browser,
  ]);
}

function clockProperties(): readonly RestrictedProperty[] {
  return [
    { object: "Date", property: "now", message: clockText },
    { object: "Math", property: "random", message: clockText },
    { object: "crypto", property: "randomUUID", message: clockText },
    { object: "crypto", property: "getRandomValues", message: clockText },
    { object: "performance", property: "now", message: clockText },
  ];
}

function propertiesFor(row: PackageRow): readonly RestrictedProperty[] {
  const display = row.formatsDisplay === true;
  return [
    ...(row.compositionRoot === true
      ? []
      : [{ object: "process", property: "argv", message: "Only the CLI reads arguments." }]),
    ...(row.osLayer === true
      ? []
      : [
          { object: "process", property: "platform", message: "Only platform branches on the OS." },
        ]),
    ...(row.pure === true ? clockProperties() : []),
    ...(row.money === true
      ? ["parseFloat", "parseInt"].map((property) => ({
          object: "Number",
          property,
          message: moneyText,
        }))
      : []),
    ...(row.money === true || !display ? [{ property: "toFixed", message: displayText }] : []),
    ...(display ? [] : [{ property: "toLocaleString", message: displayText }]),
    ...(row.userText === true
      ? [{ property: "message", message: "Show i18n text chosen by the error code." }]
      : []),
  ];
}

/** Builds what one package, or one exempt folder of it, may not import or touch. */
export function restrictionsFor(graph: PackageGraph, options: ScopeOptions): Restrictions {
  return {
    paths: uniqueByName([...purePaths(options.row), ...nodePaths(options.row)]),
    patterns: [
      ...graphPatterns(graph, options),
      ...layoutPatterns(graph.scope),
      ...browserPatterns(options.loadedBy),
    ],
    globals: globalsFor(options.row, options.loadedBy),
    properties: propertiesFor(options.row),
  };
}
