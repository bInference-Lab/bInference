import { fixturePackage } from "./fixture-package.mjs";
import { failingCase, type GateCase } from "./gate-case.mjs";

const pages = "apps/docs/src/content/docs";

const docsCases: readonly GateCase[] = [
  failingCase(
    "an English docs page without its Chinese twin fails check:docs",
    { [`${pages}/start.mdx`]: "# Start\n" },
    ["check:docs", /start\.mdx: check:docs: has no Chinese twin .*start\.zh\.mdx/],
  ),
  failingCase(
    "a meta.json without its meta.zh.json fails check:docs",
    { [`${pages}/meta.json`]: "{}\n" },
    ["check:docs", /meta\.json: check:docs: has no Chinese twin .*meta\.zh\.json/],
  ),
  {
    name: "docs pages and meta files with their Chinese twins pass check:docs",
    files: {
      [`${pages}/start.mdx`]: "# Start\n",
      [`${pages}/start.zh.mdx`]: "# Start\n",
      [`${pages}/meta.json`]: "{}\n",
      [`${pages}/meta.zh.json`]: "{}\n",
    },
    steps: [{ command: ["pnpm", "check:docs"], expect: "pass" }],
  },
];

const subpathManifest = `${JSON.stringify(
  {
    name: "@binference/core",
    version: "0.0.0",
    private: true,
    type: "module",
    exports: {
      ".": { "@binference/source": "./src/index.ts" },
      "./extra": { "@binference/source": "./src/extra.ts" },
    },
  },
  null,
  2,
)}\n`;

const documented = {
  "index.ts": 'export * from "./ready.js";\nexport { total as sum } from "./total.js";\n',
  "ready.ts": "/** Marks the package as present. */\nexport const ready: number = 1;\n",
  "total.ts":
    "/** Adds two amounts in base units. */\nexport function total(a: bigint, b: bigint): bigint {\n  return a + b;\n}\n",
};

const tsdocCases: readonly GateCase[] = [
  failingCase(
    "an export without TSDoc fails check:tsdoc",
    fixturePackage("core", {
      "index.ts": 'export { ready } from "./ready.js";\n',
      "ready.ts": "export const ready: number = 1;\n",
    }),
    ["check:tsdoc", /packages\/core\/src\/ready\.ts:1: check:tsdoc: ready has no TSDoc sentence/],
  ),
  failingCase(
    "a TSDoc block without a sentence fails check:tsdoc",
    fixturePackage("core", { "index.ts": "/** @internal */\nexport const ready: number = 1;\n" }),
    ["check:tsdoc", /index\.ts:2: check:tsdoc: ready has no TSDoc sentence/],
  ),
  failingCase(
    "an undocumented export of a subpath entry fails check:tsdoc",
    {
      ...fixturePackage("core", {
        "extra.ts": "export function extra(): number {\n  return 1;\n}\n",
      }),
      "packages/core/package.json": subpathManifest,
    },
    ["check:tsdoc", /extra\.ts:1: check:tsdoc: extra has no TSDoc sentence/],
  ),
  {
    name: "documented exports reached through re-exports pass check:tsdoc",
    files: fixturePackage("core", documented),
    steps: [{ command: ["pnpm", "check:tsdoc"], expect: "pass" }],
  },
];

/** Cases for check:docs (Chinese twins) and check:tsdoc (TSDoc on every reachable export). */
export function docsAndTsdocCases(): readonly GateCase[] {
  return [...docsCases, ...tsdocCases];
}
