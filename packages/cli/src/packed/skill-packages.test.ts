import { isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createManualClock } from "@binference/core/testing";
import { ensurePrivateFolder, listFolderFiles, readTextFile } from "@binference/platform";
import { createTempFolder, type TempFolder } from "@binference/platform/testing";
import { afterEach, describe, expect, it } from "vitest";
import { noPermissions } from "../e2e/test-host.js";
import { packFolder, writeFiles } from "../skills/skill-fixtures.js";
import { installPackedSkill } from "./install-packed-skill.js";
import { agentToolsNamed } from "./mcp-skill-copy.js";
import { type SkillPackage, skillPackage, skillPackageName } from "./skill-packages.js";

const repo = fileURLToPath(new URL("../../../../", import.meta.url));
const signal = (): AbortSignal => AbortSignal.timeout(60_000);

// A file of the repository by its path in it, or any file by its absolute path.
async function read(path: string): Promise<string> {
  const text = await readTextFile(isAbsolute(path) ? path : join(repo, path), signal());
  return text.ok ? text.value : "";
}

const readmes = {
  en: await read("config/release/skill-package/README.md"),
  zh: await read("config/release/skill-package/README.zh.md"),
};

// A file of a staged package, or an empty text when it holds none.
function fileOf(made: SkillPackage, path: string): string {
  return made.files.get(path) ?? "";
}

function manifestOf(made: SkillPackage): unknown {
  return JSON.parse(fileOf(made, "package.json"));
}

const state: { folder?: TempFolder } = {};

afterEach(async () => {
  await state.folder?.remove();
});

async function packageOf(skill: string, isNightly = false) {
  const text = await read(`skills/${skill}/SKILL.md`);
  const repository = "git+https://github.com/bInference-Lab/bInference.git";
  return skillPackage({ skill, text, version: "2026.11.27", isNightly, readmes, repository });
}

// Packs the package with npm, as the release does, and answers its tarball.
async function packed(skill: string): Promise<{ readonly root: string; readonly tarball: string }> {
  const folder = await createTempFolder("bnf-skill-pkg-");
  state.folder = folder;
  const made = await packageOf(skill);
  const staged = join(folder.path, "stage");
  await writeFiles(staged, {
    ...Object.fromEntries(made.files),
    LICENSE: "MIT License\n",
    "NOTICES.md": "# Notices\n",
  });
  const out = join(folder.path, "out");
  await ensurePrivateFolder(out, { permissions: noPermissions, signal: signal() });
  await packFolder(staged, out);
  const [tarball = ""] = await listFolderFiles(out, signal());
  return { root: folder.path, tarball: join(out, tarball) };
}

function install(at: { readonly root: string; readonly tarball: string }, skill: string) {
  const request = { name: skillPackageName(skill), version: "2026.11.27", tarball: at.tarball };
  const place = (folder: string) => ({
    work: join(at.root, "install", folder),
    permissions: noPermissions,
    clock: createManualClock(1_767_261_610_000),
    random: { bytes: (length: number) => new Uint8Array(length).fill(3) },
  });
  return {
    agent: async () =>
      installPackedSkill({ ...request, folder: "agent" }, place("agent"), signal()),
    mcp: async () => installPackedSkill({ ...request, folder: "mcp" }, place("mcp"), signal()),
  };
}

describe("skill packages", () => {
  it.each(["copy-trading", "dca-plan", "safe-swap", "token-due-diligence"])(
    "installs %s's agent and MCP folders from the packed tarball by its integrity",
    async (skill) => {
      const at = await packed(skill);
      const installs = install(at, skill);
      expect(await installs.agent()).toMatchObject({ ok: true, value: { name: skill } });
      expect(await installs.mcp()).toMatchObject({ ok: true, value: { name: skill } });
      const copy = await read(join(at.root, "install", "mcp", "skills", skill, "SKILL.md"));
      expect(copy).toContain("binference_");
      expect(agentToolsNamed(copy)).toStrictEqual([]);
    },
  );

  it("packs meme hunting with its agent folder alone, and installs it", async () => {
    const made = await packageOf("meme-hunting");
    expect([...made.files.keys()]).not.toContain("mcp/SKILL.md");
    expect(made.noMcpCopy).toStrictEqual({ reason: "agent_only", tools: ["market_scan"] });
    expect(fileOf(made, "README.md")).toContain("It holds no copy for MCP clients");
    const at = await packed("meme-hunting");
    expect(await install(at, "meme-hunting").agent()).toMatchObject({ ok: true });
  });

  it("fills each npm page and names the skill's folder in its manifest", async () => {
    const made = await packageOf("safe-swap");
    const pages = [fileOf(made, "README.md"), fileOf(made, "README.zh.md")];
    expect(pages.filter((page) => /\{\{|<!--/.test(page))).toStrictEqual([]);
    expect(pages[0]).toContain("npm install @binference/skill-safe-swap");
    expect(manifestOf(made)).toMatchObject({
      name: "@binference/skill-safe-swap",
      version: "2026.11.27",
      repository: { directory: "skills/safe-swap" },
      files: ["agent", "mcp", "NOTICES.md", "README.zh.md"],
    });
  });

  it("marks a nightly's manifest private, so npm never publishes it", async () => {
    const made = await packageOf("dca-plan", true);
    expect(manifestOf(made)).toMatchObject({ private: true });
  });

  it("refuses a skill that is not the agent's", async () => {
    const text = await read("skills/binference-tools/SKILL.md");
    const source = { version: "1.0.0", isNightly: false, readmes, repository: "x" };
    expect(() => skillPackage({ skill: "binference-tools", text, ...source })).toThrow(
      "not a skill of the agent",
    );
  });
});
