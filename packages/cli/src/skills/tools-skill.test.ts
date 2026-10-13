import { fileURLToPath } from "node:url";
import { BinferenceError } from "@binference/core";
import { readTextFile } from "@binference/platform";
import { lintSkill } from "@binference/plugin-sdk";
import { mcpTools } from "@binference/protocol";
import { describe, expect, it } from "vitest";
import { readSkillFile } from "./skill-file.js";

// The skill MCP clients get, in the repo's bundled skills.
const skillFile = fileURLToPath(
  new URL("../../../../skills/binference-tools/SKILL.md", import.meta.url),
);

// What the Agent Skills format allows in the frontmatter (agentskills.io/specification).
const allowedKeys = new Set([
  "name",
  "description",
  "license",
  "compatibility",
  "metadata",
  "allowed-tools",
]);

async function skillText(): Promise<string> {
  const read = await readTextFile(skillFile, AbortSignal.timeout(5_000));
  if (!read.ok) {
    throw new BinferenceError({ code: "test.no_skill", message: `${skillFile} is missing.` });
  }
  return read.value;
}

function frontmatterOf(text: string): ReadonlyMap<string, string> {
  const block = /^---\n([\s\S]*?)\n---\n/.exec(text)?.[1] ?? "";
  const keys = [...block.matchAll(/^([a-z-]+):[ \t]*(.*)$/gm)];
  return new Map(keys.map((match) => [match[1] ?? "", match[2] ?? ""]));
}

describe("the binference-tools skill", () => {
  it("never tells the agent to ask for a key, a seed phrase or a passphrase", async () => {
    expect(lintSkill(await skillText())).toStrictEqual([]);
  });

  it("names every MCP tool, and no tool the MCP server lacks", async () => {
    const text = await skillText();
    const named = new Set(text.match(/\bbinference_[a-z_]+\b/g));
    expect([...named].toSorted()).toStrictEqual(mcpTools.map((tool) => tool.name).toSorted());
  });

  it("keeps to the Agent Skills frontmatter, with a short name and description", async () => {
    const frontmatter = frontmatterOf(await skillText());
    expect(frontmatter.get("name")).toBe("binference-tools");
    expect([...frontmatter.keys()].filter((key) => !allowedKeys.has(key))).toStrictEqual([]);
    expect(frontmatter.get("description")).toMatch(/^.{1,1024}$/);
  });

  it("is for MCP clients alone, so no agent's index lists it", async () => {
    expect(readSkillFile(await skillText())).toMatchObject({
      ok: true,
      value: { name: "binference-tools", audience: "mcp" },
    });
  });
});
