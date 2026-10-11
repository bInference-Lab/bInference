import { join } from "node:path";
import { sha256Hex, type TokenRecord } from "@binference/engine";
import { testNowMs } from "@binference/engine/testing";
import {
  ensurePrivateFolder,
  type FileWatch,
  listFolderFiles,
  readTextFile,
  watchFile,
} from "@binference/platform";
import { standInProgramsRun, writeStandInProgram } from "@binference/platform/testing";
import { afterEach, describe, expect, it } from "vitest";
import { type SkeletonComposition, skeletonCompositions } from "../compose/test-skeleton.js";
import { runCli } from "../program/run-cli.js";
import { type ServedSkeleton, serveSkeleton } from "./skeleton-machine.js";
import { createTestMachines, hostWith, noPermissions, type TestMachine } from "./test-host.js";

const slow = { timeout: 60_000 };
const machines = createTestMachines();
const served: ServedSkeleton[] = [];
const live = { signal: new AbortController().signal };
const files = { permissions: noPermissions, ...live };

afterEach(async () => {
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

interface Session {
  readonly machine: TestMachine;
  readonly skeleton: ServedSkeleton;
  readonly home: string;
  readonly log: string;
  readonly env: Readonly<Record<string, string>>;
}

/** What a stand-in client recorded: its arguments, its token variable and the config it read. */
interface ClientRecord {
  readonly argv: readonly string[];
  readonly token: string;
  /** The names of the client's variables whose value holds a `bnt_` secret. */
  readonly secretVariables: readonly string[];
  /** Claude Code's config file and its mode; empty and 0 for Codex. */
  readonly config: string;
  readonly configMode: number;
  /** `SIGTERM` once it got one; empty before. */
  readonly signal: string;
}

/** Whether the stand-in exits at once, or runs until a `SIGTERM`. */
type StandIn = "exits" | "waits";

// A stand-in client on PATH that records what it was started with, then exits with 0, or runs
// until a SIGTERM and records it. It never runs the real client.
function standInScript(log: string, kind: StandIn): string {
  const end =
    kind === "waits"
      ? `process.on("SIGTERM", () => { record({ signal: "SIGTERM" }); process.exit(143); }); setInterval(() => undefined, 1000); record({});`
      : `record({});`;
  return [
    `import { appendFileSync, readFileSync, statSync } from "node:fs";`,
    `const argv = process.argv.slice(2);`,
    `const file = argv[argv.indexOf("--mcp-config") + 1] ?? "";`,
    `const read = argv.includes("--mcp-config") ? { config: readFileSync(file, "utf8"), configMode: statSync(file).mode & 0o777 } : { config: "", configMode: 0 };`,
    `const token = process.env.BINFERENCE_MCP_TOKEN ?? "";`,
    `const secretVariables = Object.entries(process.env).filter(([, value]) => value?.includes("bnt_")).map(([name]) => name);`,
    `const record = (extra) => appendFileSync(${JSON.stringify(log)}, JSON.stringify({ argv, token, secretVariables, ...read, signal: "", ...extra }) + "\\n");`,
    end,
  ].join("\n");
}

// A served engine, a home of its own, and a PATH that holds only the stand-in client.
async function servedSession(
  client: "claude" | "codex",
  kind: StandIn = "exits",
  outer: Readonly<Record<string, string>> = {},
): Promise<Session> {
  const machine = await machines.create(testNowMs);
  const skeleton = await serveSkeleton(machine, selfHosted());
  served.push(skeleton);
  const home = join(machine.folder, "home");
  const bin = join(machine.folder, "bin-path");
  await ensurePrivateFolder(home, files);
  await ensurePrivateFolder(bin, files);
  const log = join(machine.folder, "client.log");
  await writeStandInProgram(bin, client, standInScript(log, kind));
  const env = {
    PATH: bin,
    HOME: home,
    CLAUDE_CONFIG_DIR: join(home, "claude-config"),
    CODEX_HOME: join(home, "codex-home"),
    ...outer,
  };
  return { machine, skeleton, home, log, env };
}

function start(at: Session, args: readonly string[]) {
  const host = hostWith(at.machine, ["mcp", "session", ...args], {
    env: at.env,
    parts: { homeDir: at.home },
  });
  return { host, exit: runCli(host) };
}

async function records(at: Session): Promise<readonly ClientRecord[]> {
  const text = await readTextFile(at.log, live.signal);
  const lines = text.ok ? text.value.split("\n") : [];
  return lines.filter((line) => line !== "").map((line) => JSON.parse(line) as ClientRecord);
}

async function firstRecord(at: Session): Promise<ClientRecord> {
  const [record] = await records(at);
  if (record === undefined) {
    throw new Error("Expected the client to have started.");
  }
  return record;
}

async function sessionToken(at: Session): Promise<TokenRecord> {
  const tokens = await at.skeleton.parts.stores.access.listTokens(live);
  const [token, ...more] = tokens.filter((item) => item.label.endsWith("-session"));
  if (token === undefined || more.length > 0) {
    throw new Error("Expected one session token.");
  }
  return token;
}

// Resolves once the stand-in's log exists: the client runs and holds its SIGTERM handler.
async function untilLogged(at: Session): Promise<void> {
  const watches: FileWatch[] = [];
  const logged = new Promise<void>((resolve, reject) => {
    const check = async (): Promise<void> => {
      if ((await readTextFile(at.log, live.signal)).ok) {
        resolve();
      }
    };
    watches.push(watchFile(at.log, { onChange: () => void check(), onError: reject }));
    void check();
  });
  await logged.finally(() => watches.forEach((watch) => watch.close()));
}

describe.runIf(standInProgramsRun)("binference mcp session", () => {
  it(
    "starts Claude Code with the secret in its server's config entry alone, then revokes",
    slow,
    async () => {
      // A variable the owner's shell happened to export never reaches Claude Code either.
      const outer = { BINFERENCE_MCP_TOKEN: `bnt_${"o".repeat(43)}` };
      const at = await servedSession("claude", "exits", outer);
      const session = start(at, ["--client", "claude-code", "--", "--model", "sonnet"]);
      await expect(session.exit).resolves.toBe(0);

      const record = await firstRecord(at);
      const token = await sessionToken(at);
      expect(record.argv.slice(0, 2)).toStrictEqual(["--strict-mcp-config", "--mcp-config"]);
      expect(record.argv.slice(3)).toStrictEqual(["--model", "sonnet"]);
      expect(record.argv.join(" ")).not.toContain("bnt_");
      expect(record.token).toBe("");
      expect(record.secretVariables).toStrictEqual([]);
      const config = JSON.parse(record.config) as {
        readonly mcpServers: {
          readonly binference: {
            readonly env: {
              readonly BINFERENCE_HOME: string;
              readonly BINFERENCE_MCP_TOKEN: string;
            };
          };
        };
      };
      expect(Object.keys(config.mcpServers)).toStrictEqual(["binference"]);
      expect(config.mcpServers.binference).toMatchObject({
        type: "stdio",
        env: { BINFERENCE_HOME: at.machine.folder },
      });
      const secret = config.mcpServers.binference.env.BINFERENCE_MCP_TOKEN;
      expect(secret).toMatch(/^bnt_[\w-]{43}$/);
      expect(sha256Hex(secret)).toBe(token.secretHash);
      expect(record.config.split("bnt_")).toHaveLength(2);
      expect(record.configMode).toBe(0o600);
      expect(token).toMatchObject({
        label: "mcp-claude-code-session",
        scopes: ["read", "propose"],
        expiresAtMs: testNowMs + 3_600_000,
        revokedAtMs: testNowMs,
      });
      expect(await listFolderFiles(join(at.machine.folder, "tmp"), live.signal)).toStrictEqual([]);
      expect(session.host.stdout()).toContain("The session's client token is revoked.");
      expect(session.host.stdout() + session.host.stderr()).not.toContain(secret);
    },
  );

  it("passes SIGTERM to the client and revokes the token once it exits", slow, async () => {
    const at = await servedSession("claude", "waits");
    const session = start(at, ["--client", "claude-code", "--ttl", "30m"]);
    await untilLogged(at);
    at.machine.signals.emit("SIGINT", "SIGINT");
    at.machine.signals.emit("SIGTERM", "SIGTERM");
    await expect(session.exit).resolves.toBe(1);

    expect((await records(at)).map((record) => record.signal)).toStrictEqual(["", "SIGTERM"]);
    const token = await sessionToken(at);
    expect(token).toMatchObject({ expiresAtMs: testNowMs + 1_800_000, revokedAtMs: testNowMs });
  });

  it(
    "starts Codex with the secret in its environment, passed to the server, kept from its shell",
    slow,
    async () => {
      const at = await servedSession("codex");
      await expect(start(at, ["--client", "codex"]).exit).resolves.toBe(0);

      const record = await firstRecord(at);
      const overrides = record.argv.filter((_arg, index) => index % 2 === 1);
      expect(overrides).toContain('mcp_servers.binference.env_vars=["BINFERENCE_MCP_TOKEN"]');
      expect(overrides).toContain(
        `mcp_servers.binference.env={ BINFERENCE_HOME = ${JSON.stringify(at.machine.folder)} }`,
      );
      expect(overrides).toContain(
        'shell_environment_policy.filters.BINFERENCE_MCP_TOKEN="exclude"',
      );
      expect(record.argv.join(" ")).not.toContain("bnt_");
      expect(record.token).toMatch(/^bnt_/);
      expect(record.secretVariables).toStrictEqual(["BINFERENCE_MCP_TOKEN"]);
      const token = await sessionToken(at);
      expect(sha256Hex(record.token)).toBe(token.secretHash);
      expect(token).toMatchObject({ label: "mcp-codex-session", revokedAtMs: testNowMs });
    },
  );

  it("revokes the token when the client is not on PATH", slow, async () => {
    const at = await servedSession("codex");
    const session = start(at, ["--client", "claude-code"]);
    await expect(session.exit).resolves.toBe(1);
    expect(session.host.stderr()).toContain("`claude` is not on PATH");
    expect((await sessionToken(at)).revokedAtMs).toBe(testNowMs);
  });

  it(
    "prints the config and the secret with --print-config and leaves the token live",
    slow,
    async () => {
      const at = await servedSession("claude");
      const session = start(at, ["--client", "claude-code", "--print-config", "--json"]);
      await expect(session.exit).resolves.toBe(0);
      const printed = JSON.parse(session.host.stdout()) as {
        readonly env: { readonly BINFERENCE_MCP_TOKEN: string };
        readonly expiresAt: number;
        readonly config: unknown;
      };
      const token = await sessionToken(at);
      expect(sha256Hex(printed.env.BINFERENCE_MCP_TOKEN)).toBe(token.secretHash);
      expect(printed.expiresAt).toBe(testNowMs + 3_600_000);
      expect(JSON.stringify(printed.config)).not.toContain("bnt_");
      expect(token.revokedAtMs).toBeUndefined();
      expect(await records(at)).toStrictEqual([]);
    },
  );
});
