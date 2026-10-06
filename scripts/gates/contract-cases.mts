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
  ];
}
