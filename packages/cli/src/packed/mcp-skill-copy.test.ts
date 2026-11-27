import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { listFolderFiles, readTextFile } from "@binference/platform";
import { lintSkill } from "@binference/plugin-sdk";
import { mcpTools } from "@binference/protocol";
import { describeAgentTools } from "@binference/runtime";
import { describe, expect, it } from "vitest";
import { readSkillFile } from "../skills/skill-file.js";
import { skillText } from "../skills/skill-fixtures.js";
import { agentToolsNamed, mcpSkillCopy } from "./mcp-skill-copy.js";

const skillsFolder = fileURLToPath(new URL("../../../../skills", import.meta.url));

async function readSkills(): Promise<ReadonlyMap<string, string>> {
  const signal = AbortSignal.timeout(10_000);
  const files = await listFolderFiles(skillsFolder, signal);
  const names = files
    .filter((file) => file.endsWith("/SKILL.md"))
    .map((file) => file.split("/")[0] ?? "");
  const texts = await Promise.all(
    names.map(async (name) => {
      const read = await readTextFile(join(skillsFolder, name, "SKILL.md"), signal);
      return [name, read.ok ? read.value : ""] as const;
    }),
  );
  return new Map(texts);
}

const skills = await readSkills();

function bundledSkill(name: string): string {
  return skills.get(name) ?? "";
}

const agentSkills = [...skills.keys()].filter((name) =>
  bundledSkill(name).includes("binference-audience: agent"),
);

// The agent's tools as its model sees them, read apart from the copy's own table.
const agentTools = new Set(describeAgentTools().map((tool) => tool.name));
const served = new Set<string>(mcpTools.map((tool) => tool.name));

function agentToolsIn(text: string): readonly string[] {
  const spans = [...text.matchAll(/`([^`\n]+)`/g)].map((match) => match[1] ?? "");
  const words = [...text.matchAll(/\b[a-z]+(?:_[a-z]+)+\b/g)].map((match) => match[0]);
  return [...spans, ...words].filter((word) => agentTools.has(word));
}

function copyOf(text: string): string {
  const copy = mcpSkillCopy(text);
  if (!copy.ok) {
    throw new Error(`no copy: ${JSON.stringify(copy.error)}`);
  }
  return copy.value;
}

function agentSkill(body: string, description = "Helps with trades."): string {
  return skillText("planted", { description, body, metadata: { "binference-audience": "agent" } });
}

describe("mcpSkillCopy over the bundled skills", () => {
  it.each(agentSkills.filter((name) => name !== "meme-hunting"))(
    "copies %s naming no tool of the agent, only tools the MCP server serves, and passes the lint",
    (name) => {
      const copy = copyOf(bundledSkill(name));
      expect(agentToolsIn(copy)).toStrictEqual([]);
      const named = [...copy.matchAll(/binference_[a-z_]+/g)].map((match) => match[0]);
      expect(named.filter((tool) => !served.has(tool))).toStrictEqual([]);
      expect(named.length).toBeGreaterThan(0);
      expect(lintSkill(copy)).toStrictEqual([]);
      expect(readSkillFile(copy)).toMatchObject({ ok: true, value: { name, audience: "mcp" } });
    },
  );

  it("gives meme hunting no copy, since its description names market_scan", () => {
    expect(mcpSkillCopy(bundledSkill("meme-hunting"))).toStrictEqual({
      ok: false,
      error: { reason: "agent_only", tools: ["market_scan"] },
    });
  });

  it("writes buy as binference_propose with its kind, and a side's value stays as it is", () => {
    const copy = copyOf(
      agentSkill('# Buy\n\nCall `buy` with `spend`, then `side: "buy"` on the order.'),
    );
    expect(copy).toContain(
      'Call `binference_propose` with `kind: "buy"` with `spend`, then `side: "buy"` on the order.',
    );
  });
});

describe("mcpSkillCopy over planted skills", () => {
  it("leaves out each block that names a tool the MCP server lacks, and keeps the rest", () => {
    const body = [
      "# Scan",
      "",
      "## 1. Read",
      "",
      "- Call `token_risk` first.",
      "- Then `chart` for candles,",
      "  over two lines.",
      "",
      "## 2. Search",
      "",
      "Ask `search_web` what people say.",
    ].join("\n");
    const copy = copyOf(agentSkill(body));
    expect(copy).toContain("- Call `binference_token_risk` first.");
    expect(copy).not.toContain("candles");
    expect(copy).not.toContain("over two lines");
    expect(copy).not.toContain("## 2. Search");
    expect(copy).toContain("## 1. Read");
  });

  it("refuses a skill whose description names a tool the MCP server lacks", () => {
    const text = agentSkill("# Hunt", "Hunts tokens with wallet_activity.");
    expect(mcpSkillCopy(text)).toStrictEqual({
      ok: false,
      error: { reason: "agent_only", tools: ["wallet_activity"] },
    });
  });

  it("refuses a skill not written for the agent", () => {
    const text = skillText("tools", { metadata: { "binference-audience": "mcp" } });
    expect(mcpSkillCopy(text)).toStrictEqual({ ok: false, error: { reason: "not_for_agent" } });
  });
});

describe("agentToolsNamed", () => {
  it("finds a tool in a code span or as a joined word, never an English word or an MCP tool", () => {
    const text = 'Call `buy`, then token_search; a quote of `binference_quote` and `side: "buy"`.';
    expect(agentToolsNamed(text)).toStrictEqual(["buy", "token_search"]);
  });

  it("knows every tool the agent's model sees", () => {
    const missing = [...agentTools].filter((tool) => agentToolsNamed(`\`${tool}\``).length === 0);
    expect(missing).toStrictEqual([]);
  });
});
