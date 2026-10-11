import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { testNowMs } from "@binference/engine/testing";
import {
  ensurePrivateFolder,
  listFolderFiles,
  readTextFile,
  writePrivateFile,
} from "@binference/platform";
import { standInProgramsRun, writeStandInProgram } from "@binference/platform/testing";
import { afterEach, describe, expect, it, vi } from "vitest";
import { type SkeletonComposition, skeletonCompositions } from "../compose/test-skeleton.js";
import { runCli } from "../program/run-cli.js";
import { type ServedSkeleton, serveSkeleton } from "./skeleton-machine.js";
import { createTestMachines, hostWith, noPermissions, type TestMachine } from "./test-host.js";

const slow = { timeout: 60_000 };
const machines = createTestMachines();
const served: ServedSkeleton[] = [];
const live = { signal: new AbortController().signal };
const files = { permissions: noPermissions, ...live };
const skillFile = fileURLToPath(
  new URL("../../../../skills/binference-tools/SKILL.md", import.meta.url),
);

afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(served.splice(0).map(async (skeleton) => skeleton.close()));
  await machines.removeAll();
});

function selfHosted(): SkeletonComposition {
  const found = skeletonCompositions.find((item) => item.name === "self-hosted");
  if (found === undefined) {
    throw new Error("Expected the self-hosted composition.");
  }
  return found;
}

async function read(path: string): Promise<string | undefined> {
  const text = await readTextFile(path, live.signal);
  return text.ok ? text.value : undefined;
}

async function readText(path: string): Promise<string> {
  const text = await readTextFile(path, live.signal);
  if (!text.ok) {
    throw new Error(`${path} is missing.`);
  }
  return text.value;
}

async function write(path: string, text: string): Promise<void> {
  await ensurePrivateFolder(dirname(path), files);
  await writePrivateFile(path, text, files);
}

async function isThere(folder: string): Promise<boolean> {
  return (await listFolderFiles(folder, live.signal)).length > 0;
}

interface Setup {
  readonly machine: TestMachine;
  readonly skeleton: ServedSkeleton;
  readonly home: string;
  readonly bin: string;
  readonly env: Readonly<Record<string, string>>;
}

// A served engine, a home of its own, and a PATH that holds only the test's own programs, so the
// real `claude` never runs. Child programs see the same variables as the host.
async function servedSetup(extra: Readonly<Record<string, string>> = {}): Promise<Setup> {
  const machine = await machines.create(testNowMs);
  const skeleton = await serveSkeleton(machine, selfHosted());
  served.push(skeleton);
  const home = join(machine.folder, "home");
  const bin = join(machine.folder, "bin-path");
  await ensurePrivateFolder(home, files);
  await ensurePrivateFolder(bin, files);
  const env = { PATH: bin, HOME: home, USERPROFILE: home, ...extra };
  Object.entries(env).forEach(([name, value]) => vi.stubEnv(name, value));
  return { machine, skeleton, home, bin, env };
}

async function setup(at: Setup, args: readonly string[]) {
  const host = hostWith(at.machine, ["mcp", "setup", ...args], {
    env: at.env,
    parts: { homeDir: at.home },
  });
  const code = await runCli(host);
  return { code, stdout: host.stdout(), stderr: host.stderr() };
}

// A `claude` on PATH that records its arguments, one JSON line a call, instead of Claude Code.
async function standInClaude(at: Setup): Promise<string> {
  const log = join(at.machine.folder, "claude-calls.log");
  const script = `import { appendFileSync } from "node:fs";\nappendFileSync(${JSON.stringify(log)}, JSON.stringify(process.argv.slice(2)) + "\\n");\n`;
  await writeStandInProgram(at.bin, "claude", script);
  return log;
}

async function calls(log: string): Promise<readonly (readonly string[])[]> {
  const text = (await read(log)) ?? "";
  return text
    .split("\n")
    .filter((line) => line !== "")
    .map((line) => JSON.parse(line) as string[]);
}

async function mcpTokens(at: Setup) {
  const tokens = await at.skeleton.parts.stores.access.listTokens(live);
  return tokens.filter((token) => token.label.startsWith("mcp-"));
}

interface ClaudeJson {
  readonly theme?: string;
  readonly mcpServers: Readonly<Record<string, unknown>>;
}

function withCodexHome(at: Setup): Setup {
  return { ...at, env: { ...at.env, CODEX_HOME: join(at.home, "codex-home") } };
}

const codexConfig = (at: Setup): string => join(at.home, "codex-home", "config.toml");
const codexToken = (at: Setup): string => join(at.machine.folder, "auth", "mcp-codex.token");

describe("binference mcp setup for Codex", () => {
  it("makes a token, adds the server table and the skill, then changes nothing", slow, async () => {
    const at = withCodexHome(await servedSetup());
    const config = codexConfig(at);
    await write(config, 'model = "gpt-5"\n\n[mcp_servers.other]\ncommand = "other"\n');

    expect((await setup(at, ["--client", "codex"])).code).toBe(0);
    const text = await readText(config);
    expect(text).toContain('[mcp_servers.other]\ncommand = "other"');
    expect(text).toContain('"mcp", "--client", "codex"]');
    expect(text).toContain(`env = { BINFERENCE_HOME = ${JSON.stringify(at.machine.folder)} }`);
    expect(text).not.toContain("bnt_");
    const skill = join(at.home, ".agents", "skills", "binference-tools", "SKILL.md");
    expect(await read(skill)).toBe(await read(skillFile));
    expect(await read(codexToken(at))).toMatch(/^bnt_[\w-]{43}\n$/);
    const made = (await mcpTokens(at)).map((token) => [token.label, token.kind, token.scopes]);
    expect(made).toStrictEqual([["mcp-codex", "mcp", ["read", "propose"]]]);

    const second = await setup(at, ["--client", "codex", "--json"]);
    expect(second.code).toBe(0);
    const { changes } = JSON.parse(second.stdout) as { changes: { action: string }[] };
    expect(changes.map((change) => change.action)).toStrictEqual([
      "unchanged",
      "unchanged",
      "unchanged",
    ]);
    expect(await read(config)).toBe(text);
    expect(await mcpTokens(at)).toHaveLength(1);
  });

  it("makes a token that expires with --ttl, and replaces it without one", slow, async () => {
    const at = withCodexHome(await servedSetup());
    const timed = await setup(at, ["--client", "codex", "--ttl", "2h", "--json"]);
    expect(timed.code).toBe(0);
    const expiresAt = testNowMs + 7_200_000;
    const { changes } = JSON.parse(timed.stdout) as { changes: { expiresAt?: number }[] };
    expect(changes[0]?.expiresAt).toBe(expiresAt);
    expect((await mcpTokens(at)).map((token) => token.expiresAtMs)).toStrictEqual([expiresAt]);
    const file = await read(codexToken(at));

    const plain = await setup(at, ["--client", "codex"]);
    expect(plain.stdout).toContain("Client token updated");
    expect(await read(codexToken(at))).not.toBe(file);
    const tokens = await mcpTokens(at);
    expect(tokens.map((token) => [token.revokedAtMs, token.expiresAtMs])).toStrictEqual([
      [testNowMs, expiresAt],
      [undefined, undefined],
    ]);
  });

  it("removes the table and the skill and revokes the token, keeping the rest", slow, async () => {
    const at = withCodexHome(await servedSetup());
    await write(codexConfig(at), 'model = "gpt-5"\n');
    await setup(at, ["--client", "codex"]);

    expect((await setup(at, ["--client", "codex", "--remove"])).code).toBe(0);
    expect(await read(codexConfig(at))).toBe('model = "gpt-5"\n');
    expect(await isThere(join(at.home, ".agents", "skills", "binference-tools"))).toBe(false);
    expect(await read(codexToken(at))).toBeUndefined();
    expect((await mcpTokens(at)).map((token) => token.revokedAtMs)).toStrictEqual([testNowMs]);
  });

  it("shows the changes with --dry-run and writes nothing", slow, async () => {
    const at = withCodexHome(await servedSetup());
    const planned = await setup(at, ["--client", "codex", "--dry-run"]);
    expect(planned.code).toBe(0);
    expect(planned.stdout).toContain("would be made");
    expect(await isThere(join(at.home, "codex-home"))).toBe(false);
    expect(await isThere(join(at.home, ".agents"))).toBe(false);
    expect(await read(codexToken(at))).toBeUndefined();
    expect(await mcpTokens(at)).toStrictEqual([]);
  });

  it("leaves a config that names the server another way as it is", slow, async () => {
    const at = withCodexHome(await servedSetup());
    const dotted = 'mcp_servers.binference.command = "elsewhere"\n';
    await write(codexConfig(at), dotted);
    const refused = await setup(at, ["--client", "codex"]);
    expect(refused.code).toBe(1);
    expect(refused.stderr).toContain(codexConfig(at));
    expect(await read(codexConfig(at))).toBe(dotted);
  });
});

describe("binference mcp setup for Claude Code", () => {
  it("writes the config file when claude is not on PATH, keeping other keys", slow, async () => {
    const at = await servedSetup();
    const configDir = join(at.home, "claude-config");
    const atDir = { ...at, env: { ...at.env, CLAUDE_CONFIG_DIR: configDir } };
    const file = join(configDir, ".claude.json");
    await write(file, JSON.stringify({ theme: "dark", mcpServers: { other: { command: "o" } } }));

    expect((await setup(atDir, ["--client", "claude-code"])).code).toBe(0);
    const json = JSON.parse(await readText(file)) as ClaudeJson;
    expect(json.theme).toBe("dark");
    expect(json.mcpServers["other"]).toStrictEqual({ command: "o" });
    const entry = json.mcpServers["binference"] as { args: string[] };
    expect(entry).toMatchObject({ type: "stdio", env: { BINFERENCE_HOME: at.machine.folder } });
    expect(entry.args.slice(-3)).toStrictEqual(["mcp", "--client", "claude-code"]);
    const skill = join(configDir, "skills", "binference-tools", "SKILL.md");
    expect(await read(skill)).toBe(await read(skillFile));
    expect(await isThere(join(at.home, ".claude"))).toBe(false);

    const again = await setup(atDir, ["--client", "claude-code"]);
    expect(again.stdout).not.toMatch(/made|updated/);
  });

  it.runIf(standInProgramsRun)(
    "runs claude mcp at user scope when claude is on PATH, removing a changed entry first",
    slow,
    async () => {
      const at = await servedSetup();
      const log = await standInClaude(at);
      const old = { type: "stdio", command: "old", args: [] };
      await write(
        join(at.home, ".claude.json"),
        JSON.stringify({ mcpServers: { binference: old } }),
      );

      expect((await setup(at, ["--client", "claude-code"])).code).toBe(0);
      const [removed, added = []] = await calls(log);
      expect(removed).toStrictEqual(["mcp", "remove", "--scope", "user", "binference"]);
      expect(added.slice(0, 5)).toStrictEqual(["mcp", "add-json", "--scope", "user", "binference"]);
      expect(JSON.parse(String(added[5]))).toMatchObject({
        type: "stdio",
        env: { BINFERENCE_HOME: at.machine.folder },
      });
      expect(await isThere(join(at.home, ".claude", "skills", "binference-tools"))).toBe(true);

      expect((await setup(at, ["--client", "claude-code", "--remove"])).code).toBe(0);
      const last = (await calls(log)).at(-1);
      expect(last).toStrictEqual(["mcp", "remove", "--scope", "user", "binference"]);
    },
  );
});
