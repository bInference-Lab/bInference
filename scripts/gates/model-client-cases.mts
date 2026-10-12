import { failingCase, type GateCase } from "./gate-case.mjs";

// The seeds are built at run time, so this file holds neither the import nor the constructor the
// check refuses.
const sdk = ["open", "ai"].join("");
const client = ["Open", "AI"].join("");

const finding = /packages\/engine\/src\/seeded-client\.ts:\d+: check:model-clients: /;

/** Cases for check:model-clients: a model SDK client built outside the runtime's providers. */
export function modelClientCases(): readonly GateCase[] {
  return [
    failingCase(
      "a model client built in engine fails check:model-clients",
      {
        "packages/engine/src/seeded-client.ts": [
          `import { ${client} } from "${sdk}";`,
          `export const model = new ${client}({ apiKey: "sk-seeded" });`,
          "",
        ].join("\n"),
      },
      ["check:model-clients", new RegExp(`${finding.source}builds a model SDK client`)],
    ),
    failingCase(
      "a model SDK imported in a runtime folder other than providers fails check:model-clients",
      {
        "packages/runtime/src/loop/seeded-client.ts": `export type { ChatCompletion } from "${sdk}/resources/chat/completions";\n`,
      },
      ["check:model-clients", /seeded-client\.ts:1: check:model-clients: imports a model SDK/],
    ),
    {
      name: "a model client built in the runtime's providers passes check:model-clients",
      files: {
        "packages/runtime/src/providers/seeded-client.ts": [
          `import { ${client} } from "${sdk}";`,
          `export const model = new ${client}({ apiKey: "sk-seeded" });`,
          "",
        ].join("\n"),
      },
      steps: [{ command: ["pnpm", "check:model-clients"], expect: "pass" }],
    },
  ];
}
