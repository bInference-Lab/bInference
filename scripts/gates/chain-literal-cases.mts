import { failingCase, type GateCase } from "./gate-case.mjs";

// Seeds are built at run time, so this file never holds the literals the check refuses.
const caipId = ["eip155", "56"].join(":");
const address = ["0x", "10ED43C718714eb63d5aA57B78B54704E256024E"].join("");

function seeded(source: string): Readonly<Record<string, string>> {
  return { "packages/engine/src/seeded.ts": `${source}\n` };
}

const finding = /check:chain-literals: packages\/engine\/src\/seeded\.ts:\d+:\d+: /;

/** Cases for check:chain-literals in a pure package. */
export function chainLiteralCases(): readonly GateCase[] {
  return [
    failingCase(
      "a CAIP chain id in engine fails check:chain-literals",
      seeded(`export const chain: string = "${caipId}";`),
      ["check:chain-literals", new RegExp(`${finding.source}A CAIP id is data`)],
    ),
    failingCase(
      "a chain key in engine fails check:chain-literals",
      seeded('export const chain: string = "bsc";'),
      ["check:chain-literals", new RegExp(`${finding.source}"bsc" is a registry id`)],
    ),
    failingCase(
      "a hex address in engine fails check:chain-literals",
      seeded(`export const router: string = "${address}";`),
      ["check:chain-literals", new RegExp(`${finding.source}An address is data`)],
    ),
    failingCase(
      "a switch on a chain id in engine fails check:chain-literals",
      seeded(
        [
          "export function pick(chainId: string): number {",
          "  switch (chainId) {",
          "    default:",
          "      return 1;",
          "  }",
          "}",
        ].join("\n"),
      ),
      ["check:chain-literals", new RegExp(`${finding.source}Look the id up in its registry`)],
    ),
    {
      name: "engine code that reads chains through the registry passes check:chain-literals",
      files: seeded(
        "export function sameChain(left: string, right: string): boolean {\n  return left === right;\n}",
      ),
      steps: [{ command: ["pnpm", "check:chain-literals"], expect: "pass" }],
    },
  ];
}
