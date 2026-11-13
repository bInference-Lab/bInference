import {
  browserLoaders,
  type PackageGraph,
  type PackageRow,
  type WorkspacePackage,
} from "./graph.mjs";
import { restrictionsFor, type Restrictions } from "./restrictions.mjs";

type RuleSetting = string | readonly unknown[];

/** One entry of an Oxlint "overrides" list. */
interface LintOverride {
  readonly files: readonly string[];
  readonly rules: Readonly<Record<string, RuleSetting>>;
}

/** The generated Oxlint config that .oxlintrc.json extends. */
export interface GeneratedLintConfig {
  readonly overrides: readonly LintOverride[];
}

/** The path of the generated config, relative to the repo root. */
export const lintConfigPath = "config/oxlint/package-rules.generated.json";

interface Scope {
  readonly key: string;
  readonly row: PackageRow;
  readonly folder: string;
  readonly anyThirdParty: boolean;
  readonly loadedBy: readonly string[];
}

function restrictionRules(restrictions: Restrictions): Record<string, RuleSetting> {
  const rules: Record<string, RuleSetting> = {
    "eslint/no-restricted-imports": [
      "error",
      { paths: restrictions.paths, patterns: restrictions.patterns },
    ],
  };
  if (restrictions.globals.length > 0) {
    rules["eslint/no-restricted-globals"] = ["error", ...restrictions.globals];
  }
  if (restrictions.properties.length > 0) {
    rules["eslint/no-restricted-properties"] = ["error", ...restrictions.properties];
  }
  return rules;
}

function traitRules(row: PackageRow): Record<string, RuleSetting> {
  return {
    ...(row.compositionRoot === true ? {} : { "node/no-process-env": "error" }),
    ...(row.pure === true
      ? {
          "guards/no-argless-date": "error",
          "typescript/prefer-readonly-parameter-types": ["error", { treatMethodsAsReadonly: true }],
        }
      : {}),
    ...(row.money === true ? { "eslint/no-implicit-coercion": "error" } : {}),
  };
}

function withTestLimits(restrictions: Restrictions, row: PackageRow): Record<string, RuleSetting> {
  const noWaiting = "Unit tests use a fake Clock: no real timers, sleeps or polling.";
  const testRestrictions: Restrictions = {
    ...restrictions,
    globals: [
      ...restrictions.globals,
      { name: "setTimeout", message: noWaiting },
      { name: "setInterval", message: noWaiting },
    ],
    properties: [
      ...restrictions.properties,
      { object: "expect", property: "poll", message: noWaiting },
    ],
  };
  const fakes = "Write a fake that implements the port.";
  return {
    ...restrictionRules(testRestrictions),
    "vitest/no-restricted-vi-methods": [
      "error",
      {
        useRealTimers: noWaiting,
        waitFor: noWaiting,
        waitUntil: noWaiting,
        ...(row.pure === true ? { mock: fakes, doMock: fakes } : {}),
      },
    ],
  };
}

/** What a file or folder with its own override allows beyond its package. */
interface PlaceAllowance {
  /** The libraries the row limits to this folder. */
  readonly libraries: readonly string[];
  /** Only Node runs it, so it keeps what a browser lacks. */
  readonly node: boolean;
}

// Each folder a row limits libraries to, and each file or folder it names as Node-only: one
// override per place, as a later override for the same files replaces an earlier one.
function placesOf(row: Scope["row"]): ReadonlyMap<string, PlaceAllowance> {
  const places = new Map<string, PlaceAllowance>();
  for (const [library, folder] of Object.entries(row.only ?? {})) {
    places.set(folder, {
      libraries: [...(places.get(folder)?.libraries ?? []), library],
      node: false,
    });
  }
  for (const place of row.node ?? []) {
    places.set(place, { libraries: places.get(place)?.libraries ?? [], node: true });
  }
  return places;
}

const sourceFile = /\.[cm]?[jt]sx?$/;

function placeOverrides(
  graph: PackageGraph,
  scope: Scope,
  [place, allowance]: readonly [string, PlaceAllowance],
): readonly LintOverride[] {
  const base = { key: scope.key, row: scope.row, anyThirdParty: scope.anyThirdParty };
  const options = { ...base, exempt: allowance.libraries };
  const root = `${scope.folder}/${place}`;
  const rules = restrictionRules(
    restrictionsFor(graph, { ...options, loadedBy: allowance.node ? [] : scope.loadedBy }),
  );
  if (sourceFile.test(place)) {
    return [{ files: [root], rules }];
  }
  const testRules = withTestLimits(restrictionsFor(graph, { ...options, loadedBy: [] }), scope.row);
  return [
    { files: [`${root}/**`], rules },
    { files: [`${root}/**/*.test.ts`], rules: testRules },
  ];
}

function scopeOverrides(graph: PackageGraph, scope: Scope): readonly LintOverride[] {
  const base = { key: scope.key, row: scope.row, anyThirdParty: scope.anyThirdParty, exempt: [] };
  const restrictions = restrictionsFor(graph, { ...base, loadedBy: scope.loadedBy });
  // Tests run on Node and never reach a browser's bundle, so they keep the rules of a package no
  // browser loads.
  const testRestrictions = restrictionsFor(graph, { ...base, loadedBy: [] });
  const overrides: LintOverride[] = [
    {
      files: [`${scope.folder}/**`],
      rules: { ...restrictionRules(restrictions), ...traitRules(scope.row) },
    },
    {
      files: [`${scope.folder}/**/*.test.ts`],
      rules: withTestLimits(testRestrictions, scope.row),
    },
  ];
  for (const entry of placesOf(scope.row)) {
    overrides.push(...placeOverrides(graph, scope, entry));
  }
  return overrides;
}

const sourceCondition = "@binference/source";

function entryFiles(item: WorkspacePackage): readonly string[] {
  const exportsField = item.manifest["exports"];
  if (typeof exportsField !== "object" || exportsField === null) {
    return [];
  }
  return Object.values(exportsField).flatMap((target: unknown) => {
    if (typeof target !== "object" || target === null || !(sourceCondition in target)) {
      return [];
    }
    const file: unknown = Reflect.get(target, sourceCondition);
    return typeof file === "string" ? [`${item.folder}/${file.replace(/^\.\//, "")}`] : [];
  });
}

/** Builds the per-package import, global and property rules from the package graph. */
export function buildLintConfig(
  graph: PackageGraph,
  packages: readonly WorkspacePackage[],
): GeneratedLintConfig {
  const loaders = browserLoaders(graph);
  const scopes: Scope[] = Object.entries(graph.packages).map(([key, row]) => ({
    key,
    row,
    folder: `packages/${key}`,
    anyThirdParty: false,
    loadedBy: loaders.get(key) ?? [],
  }));
  scopes.push({
    key: "plugins",
    row: graph.plugins,
    folder: "plugins",
    anyThirdParty: graph.plugins.anyThirdParty === true,
    loadedBy: [],
  });
  const entries = packages.flatMap(entryFiles).toSorted();
  const entryOverride: LintOverride = {
    files: entries,
    rules: { "oxc/no-barrel-file": "off", "guards/no-reexport-file": "off" },
  };
  return {
    overrides: [
      ...scopes.flatMap((scope) => scopeOverrides(graph, scope)),
      ...(entries.length === 0 ? [] : [entryOverride]),
    ],
  };
}

const lineWidth = 100;

function renderInline(value: unknown): string {
  if (typeof value !== "object" || value === null) {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    const items: readonly unknown[] = value;
    return `[${items.map(renderInline).join(", ")}]`;
  }
  const entries = Object.entries(value).map(
    ([key, item]) => `${JSON.stringify(key)}: ${renderInline(item)}`,
  );
  return `{${entries.join(", ")}}`;
}

// Short arrays and objects stay on one line, so a change to the graph reads as a small diff.
function render(value: unknown, indent: string): string {
  const inline = renderInline(value);
  if (typeof value !== "object" || value === null || indent.length + inline.length <= lineWidth) {
    return inline;
  }
  const inner = `${indent}  `;
  if (Array.isArray(value)) {
    const items: readonly unknown[] = value;
    return `[\n${items.map((item) => inner + render(item, inner)).join(",\n")}\n${indent}]`;
  }
  const entries = Object.entries(value).map(
    ([key, item]) => `${inner}${JSON.stringify(key)}: ${render(item, inner)}`,
  );
  return `{\n${entries.join(",\n")}\n${indent}}`;
}

/** The generated config as the file holds it. */
export function renderLintConfig(config: GeneratedLintConfig): string {
  return `${render(config, "")}\n`;
}
