import process from "node:process";
import { fileURLToPath } from "node:url";
import { mcpTools } from "@binference/protocol";
import { Client, type ClientOptions } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { describe, expect, it } from "vitest";
import { fixtureIds, swapArgs } from "../testing/wire-fixtures.js";

// The server process runs the TypeScript source: tsx loads it, and the source condition resolves
// workspace packages to their src.
const entry = fileURLToPath(new URL("stdio-server.entry.ts", import.meta.url));
const nodeArgs = ["--conditions=@binference/source", "--import", "tsx", entry];

// Claude Code and Codex open with the 2025 `initialize`; a 2026-07-28 client pins its revision.
const clients: readonly (readonly [string, ClientOptions])[] = [
  ["a 2025 client, as Claude Code and Codex are", { versionNegotiation: { mode: "legacy" } }],
  ["a 2026-07-28 client", { versionNegotiation: { mode: { pin: "2026-07-28" } } }],
];

async function startServer(options: ClientOptions): Promise<Client> {
  const transport = new StdioClientTransport({ command: process.execPath, args: nodeArgs });
  const client = new Client({ name: "stdio-test", version: "1.0.0" }, options);
  await client.connect(transport);
  return client;
}

async function withServer(options: ClientOptions, test: (client: Client) => Promise<void>) {
  const client = await startServer(options);
  try {
    await test(client);
  } finally {
    await client.close();
  }
}

describe("serveMcpOverStdio in its own process", () => {
  it.each(clients)(
    "lists every tool of the protocol's table to %s",
    async (_name, options) => {
      await withServer(options, async (client) => {
        const { tools } = await client.listTools();
        expect(tools.map((tool) => tool.name)).toStrictEqual(mcpTools.map((tool) => tool.name));
        expect(tools.map((tool) => tool.inputSchema.type)).toStrictEqual(
          mcpTools.map(() => "object"),
        );
        expect(tools.filter((tool) => "oneOf" in tool.inputSchema)).toStrictEqual([]);
      });
    },
    60_000,
  );

  it.each(clients)(
    "answers a proposal from %s with the intent id and the waiting text",
    async (_name, options) => {
      await withServer(options, async (client) => {
        const answer = await client.callTool({ name: "binference_propose", arguments: swapArgs });
        expect(answer.isError).toBeUndefined();
        expect(answer.content[0]).toStrictEqual({
          type: "text",
          text: `Intent ${fixtureIds.intent} is waiting for the owner's confirmation in Telegram or the console.`,
        });
      });
    },
    60_000,
  );

  it("refuses a tool outside the table, so no client can confirm through it", async () => {
    await withServer({}, async (client) => {
      const confirm = { name: "binference_confirm", arguments: { intent: fixtureIds.intent } };
      await expect(client.callTool(confirm)).rejects.toThrow("binference_confirm not found");
    });
  }, 60_000);
});
