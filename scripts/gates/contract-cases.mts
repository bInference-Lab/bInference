import { agentSuitesAwaitingPostgres } from "../contracts/postgres-suites.mjs";
import { fixturePackage } from "./fixture-package.mjs";
import type { GateCase } from "./gate-case.mjs";

const port = [
  "/** Reads stored intents. */",
  "export interface IntentStore {",
  "  count(): number;",
  "}",
  "",
].join("\n");

const suite = [
  'import type { IntentStore } from "./ports.js";',
  "",
  "/** The contract every IntentStore passes. */",
  "export function intentStoreContract(store: IntentStore): boolean {",
  "  return store.count() >= 0;",
  "}",
  "",
].join("\n");

const adapter = [
  'import type { IntentStore } from "./ports.js";',
  "",
  "/** An empty store. */",
  "export function createEmptyStore(): IntentStore {",
  "  return { count: () => 0 };",
  "}",
  "",
].join("\n");

function adapterTest(body: string): string {
  return [
    'import { expect, it } from "vitest";',
    'import { createEmptyStore } from "./empty-store.js";',
    'import { intentStoreContract } from "./intent-store-contract.js";',
    "",
    'it("passes", () => {',
    `  ${body}`,
    "});",
    "",
  ].join("\n");
}

const checkSuites = ["pnpm", "check:contract-suites"];

// A store adapter test that runs `name`, planted beside the store package's real tests.
function storeTest(name: string): string {
  return [
    'import { it } from "vitest";',
    `import { ${name} } from "./sample-contract.js";`,
    "",
    'it("passes", () => {',
    `  ${name}();`,
    "});",
    "",
  ].join("\n");
}

const sqliteTest = "packages/store/src/samples/sqlite-sample-store.test.ts";
const postgresTest = "packages/store/src/samples/sample-store.postgres.test.ts";

// The Postgres cases: a store suite on SQLite alone fails, beside its Postgres test it passes, and
// a suite the list keeps waiting fails once it runs on Postgres.
function postgresCases(): readonly GateCase[] {
  const [waiting] = agentSuitesAwaitingPostgres;
  const waitingCase: readonly GateCase[] =
    waiting === undefined
      ? []
      : [
          {
            name: "a waiting agent suite that runs on Postgres fails check:contract-suites",
            files: { [postgresTest]: storeTest(waiting) },
            steps: [
              {
                command: checkSuites,
                expect: "fail",
                output: [new RegExp(`${waiting} runs on Postgres now`)],
              },
            ],
          },
        ];
  return [
    {
      name: "a store suite that runs on SQLite alone fails check:contract-suites",
      files: { [sqliteTest]: storeTest("sampleStoreContract") },
      steps: [
        {
          command: checkSuites,
          expect: "fail",
          output: [/runs sampleStoreContract on SQLite, and no \*\.postgres\.test\.ts/],
        },
      ],
    },
    {
      name: "a store suite that runs on SQLite and Postgres passes check:contract-suites",
      files: {
        [sqliteTest]: storeTest("sampleStoreContract"),
        [postgresTest]: storeTest("sampleStoreContract"),
      },
      steps: [{ command: checkSuites, expect: "pass" }],
    },
    ...waitingCase,
  ];
}

/** Cases for check:contract-suites. */
export function contractCases(): readonly GateCase[] {
  return [
    {
      name: "a port without a contract suite fails check:contract-suites",
      files: fixturePackage("store", { "ports.ts": port }),
      steps: [{ command: checkSuites, expect: "fail", output: [/IntentStore has no contract/] }],
    },
    {
      name: "an adapter whose test never runs its port's suite fails check:contract-suites",
      files: fixturePackage("store", {
        "ports.ts": port,
        "intent-store-contract.ts": suite,
        "empty-store.ts": adapter,
        "empty-store.test.ts": adapterTest("expect(createEmptyStore().count()).toBe(0);"),
      }),
      steps: [
        { command: checkSuites, expect: "fail", output: [/never calls intentStoreContract/] },
      ],
    },
    {
      name: "a port with its suite and an adapter that runs it pass check:contract-suites",
      files: fixturePackage("store", {
        "ports.ts": port,
        "intent-store-contract.ts": suite,
        "empty-store.ts": adapter,
        "empty-store.test.ts": adapterTest(
          "expect(intentStoreContract(createEmptyStore())).toBe(true);",
        ),
      }),
      steps: [{ command: checkSuites, expect: "pass" }],
    },
    ...postgresCases(),
  ];
}
