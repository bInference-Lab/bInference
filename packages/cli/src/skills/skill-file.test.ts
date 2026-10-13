import { describe, expect, it } from "vitest";
import { readSkillFile } from "./skill-file.js";
import { skillText } from "./skill-fixtures.js";

describe("readSkillFile", () => {
  it("reads the name, the description on one line and the default audience", () => {
    const text =
      "---\nname: safe-swap\ndescription: >\n  Checks a swap\n  before it goes.\nlicense: MIT\n---\n# Safe swap\n";
    expect(readSkillFile(text)).toStrictEqual({
      ok: true,
      value: { name: "safe-swap", description: "Checks a swap before it goes.", audience: "all" },
    });
  });

  it("reads binference's own audience key from the metadata and leaves other keys out", () => {
    const text = skillText("binference-tools", {
      metadata: { "binference-audience": "mcp", author: "binference" },
    });
    expect(
      readSkillFile(text.replace("---\n", "---\nhomepage: https://example.com\n")),
    ).toMatchObject({
      ok: true,
      value: { name: "binference-tools", audience: "mcp" },
    });
  });

  it("accepts a byte order mark and Windows line endings", () => {
    const text = `${String.fromCodePoint(0xfe_ff)}${skillText("dca-plan").replaceAll("\n", "\r\n")}`;
    expect(readSkillFile(text)).toMatchObject({ ok: true, value: { name: "dca-plan" } });
  });

  it.each([
    ["no frontmatter", "# A page\n", "no_frontmatter"],
    ["a frontmatter that never closes", "---\nname: x\n", "no_frontmatter"],
    ["YAML that does not parse", "---\nname: [x\n---\n", "bad_yaml"],
    ["a key given twice", "---\nname: a\nname: b\ndescription: d\n---\n", "bad_yaml"],
    ["capitals in the name", skillText("Safe-Swap"), "bad_fields"],
    ["a name with two hyphens in a row", skillText("safe--swap"), "bad_fields"],
    ["a name that ends in a hyphen", skillText("safe-"), "bad_fields"],
    ["a name of 65 characters", skillText("a".repeat(65)), "bad_fields"],
    ["an empty description", "---\nname: x\ndescription: ''\n---\n", "bad_fields"],
    [
      "a description of 1,025 characters",
      skillText("x", { description: "d".repeat(1025) }),
      "bad_fields",
    ],
    [
      "metadata that is not text",
      "---\nname: x\ndescription: d\nmetadata:\n  n: [1]\n---\n",
      "bad_fields",
    ],
    [
      "an audience binference does not know",
      skillText("x", { metadata: { "binference-audience": "everyone" } }),
      "bad_fields",
    ],
  ])("refuses %s", (_name, text, problem) => {
    expect(readSkillFile(text)).toStrictEqual({ ok: false, error: problem });
  });

  it("refuses YAML whose aliases would expand it past a small file", () => {
    // Each layer names the one before it twice: 20 layers would be 10 million items.
    const layers = [
      "l0: &l0 [x, x, x, x, x, x, x, x, x, x]",
      ...Array.from({ length: 19 }, (_unused, index) => {
        const [level, below] = [String(index + 1), String(index)];
        return `l${level}: &l${level} [*l${below}, *l${below}]`;
      }),
    ];
    const text = `---\nname: x\ndescription: d\n${layers.join("\n")}\n---\n`;
    expect(readSkillFile(text)).toStrictEqual({ ok: false, error: "bad_yaml" });
  });
});
