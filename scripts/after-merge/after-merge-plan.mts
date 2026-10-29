/** A group of test files that read every key of a catalog another package owns. */
interface TableTests {
  readonly name: string;
  readonly why: string;
  readonly files: readonly string[];
}

/** A repo check that reads across packages, run by its package script. */
interface RepoCheck {
  readonly script: string;
  readonly why: string;
}

/** A package whose tests run, and why. */
interface ChosenPackage {
  readonly folder: string;
  readonly why: string;
}

/** A workspace package with tests, and the workspace packages it depends on. */
export interface WorkspacePackage {
  readonly folder: string;
  readonly name: string;
  /** Names of the workspace packages in its dependencies of any kind. */
  readonly dependsOn: readonly string[];
}

/** What the after-merge set runs for one range of commits. */
export interface AfterMergePlan {
  readonly packages: readonly ChosenPackage[];
  readonly tables: readonly TableTests[];
  readonly checks: readonly RepoCheck[];
  /** Why check:gates runs, when it does. */
  readonly gates: string | undefined;
}

// Tests that enumerate a catalog: a merge that adds a key without its rows turns them red even
// when it never touched their package.
const tableTests: readonly TableTests[] = [
  {
    name: "message catalog",
    why: "every message key exists in English and Chinese and formats",
    files: ["packages/i18n/src/messages.test.ts"],
  },
  {
    name: "Telegram notices",
    why: "every notice key of the catalog has its row in the owner's chat, and no other",
    files: [
      "packages/telegram/src/notices/notice-table.test.ts",
      "packages/telegram/src/notices/notice-table.zh.test.ts",
      "packages/telegram/src/notices/create-notice-outbox.test.ts",
    ],
  },
  {
    name: "console notices",
    why: "the console shows every notice of the table in both languages",
    files: [
      "packages/console/src/notices/notice-area.test.tsx",
      "packages/console/src/notices/notice-area.zh.test.tsx",
    ],
  },
  {
    name: "terminal chat notices",
    why: "terminal chat prints every notice of the table in both languages",
    files: ["packages/tui/src/notice-table.test.ts", "packages/tui/src/notice-table.zh.test.ts"],
  },
  {
    name: "card keys",
    why: "every card key has its messages, and no other message uses a card area",
    files: [
      "packages/engine/src/confirmations/card-line.test.ts",
      "packages/engine/src/pnl/draw-pnl-card.test.ts",
    ],
  },
  {
    name: "intent reasons and states",
    why: "the closed lists of reason codes and states keep their counts",
    files: [
      "packages/engine/src/intents/intent-reason.test.ts",
      "packages/engine/src/intents/intent-state.test.ts",
    ],
  },
  {
    name: "auto mode",
    why: "every proposal gets the reason auto mode gives it, refusals added by a merge included",
    files: ["packages/engine/src/approval/auto-mode.property.test.ts"],
  },
  {
    name: "protocol operations",
    why: "every operation of the spec has one scope and its columns",
    files: ["packages/protocol/src/operations/operations.test.ts"],
  },
];

const repoChecks: readonly RepoCheck[] = [
  { script: "check:adr", why: "two branches may take the same decision number" },
  { script: "check:store", why: "two branches may take the same migration number" },
  { script: "check:config-schema", why: "a config shape change needs its own migration" },
  { script: "check:protocol-compat", why: "the protocol snapshot of a version only grows" },
  { script: "check:chain-literals", why: "a merged fixture may spell a chain in a pure package" },
  { script: "check:i18n", why: "every error code and glossary term has words in both languages" },
  { script: "check:contract-suites", why: "every adapter and fake runs its port's suite" },
];

// Files every package's tests read: a change to one reaches them all.
const sharedFiles = [
  /^vitest\.config\.ts$/,
  /^config\/vitest\//,
  /^tsconfig(?:\.base)?\.json$/,
  /^package\.json$/,
  /^pnpm-(?:lock|workspace)\.yaml$/,
];
// The gates' scripts and configs: check:gates plants a violation for each gate and expects it to
// fail, so a change to one of these files runs it.
const gateFiles = [
  /^scripts\//,
  /^config\/(?:oxlint|style|opengrep)\//,
  /^commitlint\.config\.mts$/,
  /^\.(?:oxlintrc\.json|oxfmtrc\.jsonc|jscpd\.json|markdownlint-cli2\.jsonc)$/,
  /^knip\.jsonc$/,
];
const packageFile = /^((?:packages|plugins)\/[^/]+)\/(.+)$/;
// The bundled skills ship with the CLI, whose tests read them.
const skillFile = /^skills\//;
const cliFolder = "packages/cli";

function filesPer(folder: string, changed: readonly string[]): number {
  return changed.filter((file) => file.startsWith(`${folder}/`)).length;
}

function touchedPackages(changed: readonly string[], folders: readonly string[]): ChosenPackage[] {
  const touched = new Set(
    changed.flatMap((file) => {
      const [, folder = "", rest = ""] = packageFile.exec(file) ?? [];
      return folder.length > 0 && !rest.endsWith(".md") ? [folder] : [];
    }),
  );
  const chosen = folders
    .filter((folder) => touched.has(folder))
    .map((folder) => ({ folder, why: `${String(filesPer(folder, changed))} files changed` }));
  const skills = changed.filter((file) => skillFile.test(file)).length;
  const cli =
    skills > 0 && folders.includes(cliFolder) && !touched.has(cliFolder)
      ? [{ folder: cliFolder, why: `${String(skills)} bundled skill files changed` }]
      : [];
  return [...chosen, ...cli];
}

// Walks the dependency edges backwards from the changed packages: every package that imports one,
// directly or through others, runs its tests too, and names the changed package it reaches.
function withDependents(
  touched: readonly ChosenPackage[],
  workspace: readonly WorkspacePackage[],
): ChosenPackage[] {
  const nameOf = new Map(workspace.map(({ folder, name }) => [folder, name]));
  const chosen = new Map(touched.map((item) => [item.folder, item.why]));
  const origin = new Map(touched.map(({ folder }) => [folder, folder]));
  const queue = touched.map(({ folder }) => folder);
  for (let next = queue.shift(); next !== undefined; next = queue.shift()) {
    const name = nameOf.get(next);
    const from = origin.get(next) ?? next;
    for (const item of workspace.filter((row) => !chosen.has(row.folder))) {
      if (name !== undefined && item.dependsOn.includes(name)) {
        chosen.set(item.folder, `depends on ${from}, which changed`);
        origin.set(item.folder, from);
        queue.push(item.folder);
      }
    }
  }
  return [...chosen].map(([folder, why]) => ({ folder, why }));
}

/**
 * Chooses what the after-merge set runs: the tests of each package with a changed file other
 * than its Markdown and of every package that depends on one, every package when a file all
 * tests read changed, check:gates when a gate's script or config changed, and always the table
 * tests and repo checks. `workspace` lists the package folders that hold tests.
 */
export function planAfterMerge(
  changed: readonly string[],
  workspace: readonly WorkspacePackage[],
): AfterMergePlan {
  const folders = workspace.map(({ folder }) => folder);
  const shared = changed.find((file) => sharedFiles.some((pattern) => pattern.test(file)));
  const packages =
    shared === undefined
      ? withDependents(touchedPackages(changed, folders), workspace)
      : folders.map((folder) => ({ folder, why: `${shared} changed, which every test reads` }));
  const gate = changed.find((file) => gateFiles.some((pattern) => pattern.test(file)));
  return {
    packages: packages.toSorted((a, b) => a.folder.localeCompare(b.folder)),
    tables: tableTests,
    checks: repoChecks,
    gates: gate === undefined ? undefined : `${gate} changed, a gate's script or config`,
  };
}
