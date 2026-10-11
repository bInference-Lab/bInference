import { join } from "node:path";
import { PassThrough } from "node:stream";
import type { Id } from "@binference/core";
import { testAgent, testNowMs } from "@binference/engine/testing";
import { ensurePrivateFolder, writePrivateFile } from "@binference/platform";
import { Client } from "@modelcontextprotocol/client";
import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";
import { afterEach, describe, expect, it } from "vitest";
import {
  type SkeletonComposition,
  skeletonCompositions,
  skeletonSecrets,
} from "../compose/test-skeleton.js";
import { runCli } from "../program/run-cli.js";
import { type ServedSkeleton, serveSkeleton } from "./skeleton-machine.js";
import { createTestMachines, hostWith, noPermissions, type TestMachine } from "./test-host.js";

const slow = { timeout: 60_000 };
const machines = createTestMachines();
const served: ServedSkeleton[] = [];

function selfHosted(): SkeletonComposition {
  const found = skeletonCompositions.find((item) => item.name === "self-hosted");
  if (found === undefined) {
    throw new Error("Expected the self-hosted composition.");
  }
  return found;
}

afterEach(async () => {
  await Promise.all(served.splice(0).map(async (skeleton) => skeleton.close()));
  await machines.removeAll();
});

async function writeToken(machine: TestMachine, name: string, token: string): Promise<void> {
  const files = { permissions: noPermissions, signal: new AbortController().signal };
  await ensurePrivateFolder(join(machine.folder, "auth"), files);
  await writePrivateFile(join(machine.folder, "auth", name), `${token}\n`, files);
}

async function mcpTokenOf(skeleton: ServedSkeleton): Promise<Id<"tok">> {
  const tokens = await skeleton.parts.stores.access.listTokens({
    signal: AbortSignal.timeout(5_000),
  });
  const found = tokens.find((token) => token.kind === "mcp");
  if (found === undefined) {
    throw new Error("Expected the skeleton's MCP token.");
  }
  return found.id;
}

// `binference mcp` on the machine over pipes, with an MCP client in the place of Claude Code.
function startMcp(machine: TestMachine, argv: readonly string[]) {
  const toServer = new PassThrough();
  const fromServer = new PassThrough();
  const host = hostWith(machine, argv, {
    env: {},
    parts: { mcpStdio: { input: toServer, output: fromServer } },
  });
  return { host, toServer, fromServer, exit: runCli(host) };
}

describe("binference mcp", () => {
  it(
    "serves the tools with the client's token and lists the agents through the engine",
    slow,
    async () => {
      const machine = await machines.create(testNowMs);
      served.push(await serveSkeleton(machine, selfHosted()));
      await writeToken(machine, "mcp-codex.token", skeletonSecrets.mcp);
      const mcp = startMcp(machine, ["mcp", "--client", "codex"]);
      const client = new Client({ name: "codex", version: "1.0.0" });
      await client.connect(new StdioServerTransport(mcp.fromServer, mcp.toServer));
      const { tools } = await client.listTools();
      expect(tools.map((tool) => tool.name)).toContain("binference_agents");
      const agents = await client.callTool({ name: "binference_agents", arguments: {} });
      expect(agents.isError).toBeUndefined();
      expect(JSON.stringify(agents.content)).toContain(testAgent);
      mcp.toServer.end();
      await expect(mcp.exit).resolves.toBe(0);
      await client.close();
      expect(mcp.host.stdout()).toBe("");
      expect(mcp.host.stderr()).not.toContain(skeletonSecrets.mcp);
    },
  );

  it("loses its engine connection once its token is revoked", slow, async () => {
    const machine = await machines.create(testNowMs);
    const skeleton = await serveSkeleton(machine, selfHosted());
    served.push(skeleton);
    await writeToken(machine, "mcp-codex.token", skeletonSecrets.mcp);
    const mcp = startMcp(machine, ["mcp", "--client", "codex"]);
    const client = new Client({ name: "codex", version: "1.0.0" });
    await client.connect(new StdioServerTransport(mcp.fromServer, mcp.toServer));
    const before = await client.callTool({ name: "binference_agents", arguments: {} });
    expect(before.isError).toBeUndefined();
    const live = { signal: AbortSignal.timeout(5_000) };
    await skeleton.client.call("token/revoke", { token: await mcpTokenOf(skeleton) }, live);
    const after = await client.callTool({ name: "binference_agents", arguments: {} });
    expect(after.isError).toBe(true);
    expect(JSON.stringify(after.content)).toContain("auth.revoked");
    mcp.toServer.end();
    await expect(mcp.exit).resolves.toBe(0);
    await client.close();
  });

  it("exits 1 and names the token file when the client has none", async () => {
    const machine = await machines.create(testNowMs);
    const mcp = startMcp(machine, ["mcp", "--client", "claude-code"]);
    await expect(mcp.exit).resolves.toBe(1);
    expect(mcp.host.stderr()).toContain(join(machine.folder, "auth", "mcp-claude-code.token"));
    expect(mcp.host.stderr()).toContain("binference mcp setup");
  });
});
