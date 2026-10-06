import type { PackageGraph, PackageRow, WorkspacePackage } from "./graph.mjs";
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

function scopeOverrides(graph: PackageGraph, scope: Scope): readonly LintOverride[] {
  const base = { key: scope.key, row: scope.row, anyThirdParty: scope.anyThirdParty };
  const restrictions = restrictionsFor(graph, { ...base, exempt: [] });
  const overrides: LintOverride[] = [
    {
      files: [`${scope.folder}/**`],
      rules: { ...restrictionRules(restrictions), ...traitRules(scope.row) },
    },
    { files: [`${scope.folder}/**/*.test.ts`], rules: withTestLimits(restrictions, scope.row) },
  ];
  for (const [library, folder] of Object.entries(scope.row.only ?? {})) {
    const exempt = restrictionsFor(graph, { ...base, exempt: [library] });
    const root = `${scope.folder}/${folder}`;
    overrides.push(
      { files: [`${root}/**`], rules: restrictionRules(exempt) },
      { files: [`${root}/**/*.test.ts`], rules: withTestLimits(exempt, scope.row) },
    );
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
  const scopes: Scope[] = Object.entries(graph.packages).map(([key, row]) => ({
    key,
    row,
    folder: `packages/${key}`,
    anyThirdParty: false,
  }));
  scopes.push({
    key: "plugins",
    row: graph.plugins,
    folder: "plugins",
    anyThirdParty: graph.plugins.anyThirdParty === true,
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
