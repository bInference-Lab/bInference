import { describe, expect, it } from "vitest";
import { repairToolName } from "./repair-tool-name.js";

const names = ["swap", "notes_search", "mcp-docs-read"];

describe("repairToolName", () => {
  it.each([
    { written: "SWAP", name: "swap", steps: ["name_case"] },
    { written: "function.swap", name: "swap", steps: ["name_prefix"] },
    { written: "tool/notes_search", name: "notes_search", steps: ["name_prefix"] },
    {
      written: "FUNCTIONS:Mcp-Docs-Read",
      name: "mcp-docs-read",
      steps: ["name_prefix", "name_case"],
    },
  ])("reads $written as $name", ({ written, name, steps }) => {
    expect(repairToolName(written, names)).toStrictEqual({ name, steps });
  });

  it.each([
    { why: "a declared name", written: "swap" },
    { why: "a name that fits no tool", written: "swaps" },
    { why: "two prefixes", written: "functions.tools.swap" },
    { why: "a prefix of another kind", written: "api.swap" },
    { why: "space around the name", written: " swap" },
    { why: "a letter that folds only outside ascii", written: "Key" },
  ])("answers no repair for $why", ({ written }) => {
    expect(repairToolName(written, [...names, "key"])).toBeUndefined();
  });

  it("answers no repair for a name that fits two tools by case", () => {
    expect(repairToolName("Read", ["read", "READ"])).toBeUndefined();
  });
});
