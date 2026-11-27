import { readSkillFile } from "../skills/skill-file.js";
import { type McpCopyRefusal, mcpSkillCopy } from "./mcp-skill-copy.js";

/** The npm name of a bundled skill's package (decision 0457). */
export function skillPackageName(skill: string): string {
  return `@binference/skill-${skill}`;
}

/** The npm page of a skill package in English and Simplified Chinese, before it is filled in. */
interface SkillReadmeTemplates {
  readonly en: string;
  readonly zh: string;
}

/** What a skill package is made from. */
export interface SkillPackageSource {
  /** The skill's folder name in `skills/`. */
  readonly skill: string;
  /** Its `SKILL.md`. */
  readonly text: string;
  readonly version: string;
  /** A nightly pack: the manifest says `"private": true`, so npm never publishes it. */
  readonly isNightly: boolean;
  readonly readmes: SkillReadmeTemplates;
  /** The repository's git URL, as the published packages name it. */
  readonly repository: string;
}

/** A skill package's files by their paths in it, and why it holds no copy for MCP clients. */
export interface SkillPackage {
  readonly name: string;
  readonly files: ReadonlyMap<string, string>;
  /** Set when the package holds no `mcp/SKILL.md`. */
  readonly noMcpCopy?: McpCopyRefusal;
}

/** The files every skill package holds besides `package.json` and its skill folders. */
export const skillPackageShared: readonly string[] = ["LICENSE", "NOTICES.md"];

// Keeps the block of a template between `<!-- <kept> -->` and `<!-- end -->` and drops the other.
function filled(template: string, kept: string, values: Readonly<Record<string, string>>): string {
  const dropped = kept === "with-mcp" ? "without-mcp" : "with-mcp";
  const text = template
    .replaceAll(new RegExp(`<!-- ${dropped} -->[\\s\\S]*?<!-- end -->\\n?`, "g"), "")
    .replaceAll(new RegExp(`<!-- (?:${kept}|end) -->\\n?`, "g"), "")
    .replaceAll(/\{\{([a-z]+)\}\}/g, (marker, key: string) => values[key] ?? marker);
  return `${text.replaceAll(/\n{3,}/g, "\n\n").trim()}\n`;
}

function manifestOf(source: SkillPackageSource, folders: readonly string[]): string {
  const manifest = {
    name: skillPackageName(source.skill),
    version: source.version,
    description: `The ${source.skill} skill of binference, in the Agent Skills format.`,
    keywords: ["agent-skills", "binference", "skill"],
    license: "MIT",
    repository: { type: "git", url: source.repository, directory: `skills/${source.skill}` },
    files: [...folders, "NOTICES.md", "README.zh.md"],
    publishConfig: { access: "public", provenance: true },
    ...(source.isNightly ? { private: true } : {}),
  };
  return `${JSON.stringify(manifest, null, 2)}\n`;
}

/**
 * Lays out one bundled skill as an npm package (decision 0457): `agent/SKILL.md` as the skill
 * reads in `skills/`, `mcp/SKILL.md` derived from it for MCP clients (`mcpSkillCopy`) when the
 * skill has such a copy, an npm page in each language and a manifest at the release's version.
 * The caller adds `LICENSE` and `NOTICES.md`. Throws when the skill's `SKILL.md` does not read or
 * is not one of the agent's.
 */
export function skillPackage(source: SkillPackageSource): SkillPackage {
  const front = readSkillFile(source.text);
  if (!front.ok || front.value.name !== source.skill || front.value.audience !== "agent") {
    throw new Error(`skills/${source.skill}/SKILL.md is not a skill of the agent by that name.`);
  }
  const copy = mcpSkillCopy(source.text);
  const name = skillPackageName(source.skill);
  const values = { package: name, skill: source.skill, description: front.value.description };
  const kept = copy.ok ? "with-mcp" : "without-mcp";
  const mcpFiles: [string, string][] = copy.ok ? [["mcp/SKILL.md", copy.value]] : [];
  const files = new Map<string, string>([
    ["package.json", manifestOf(source, copy.ok ? ["agent", "mcp"] : ["agent"])],
    ["agent/SKILL.md", source.text],
    ...mcpFiles,
    ["README.md", filled(source.readmes.en, kept, values)],
    ["README.zh.md", filled(source.readmes.zh, kept, values)],
  ]);
  return copy.ok ? { name, files } : { name, files, noMcpCopy: copy.error };
}
