import { PassThrough } from "node:stream";
import { Client } from "@modelcontextprotocol/client";
import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";
import { describe, expect, it } from "vitest";
import { serveMcpOverStdio } from "../server/serve-stdio.js";
import { codedError, createFakeProtocolClient } from "../testing/fake-protocol-client.js";
import { createRecordingLogger } from "../testing/recording-logger.js";
import { fixtureIds, proposedIntent, swapArgs } from "../testing/wire-fixtures.js";

// The two pipes of a stdio connection, as the MCP client's process would hold their other ends.
function pipes() {
  const toServer = new PassThrough();
  const fromServer = new PassThrough();
  return { toServer, fromServer, streams: { input: toServer, output: fromServer } };
}

// The first text block of a tool's answer.
function firstText(answer: Awaited<ReturnType<Client["callTool"]>>): string {
  const [first] = answer.content;
  return first?.type === "text" ? first.text : "";
}

// The client side speaks the same newline-delimited JSON over the other ends of the pipes.
async function connectClient(toServer: PassThrough, fromServer: PassThrough): Promise<Client> {
  const client = new Client({ name: "pipes", version: "1.0.0" });
  await client.connect(new StdioServerTransport(fromServer, toServer));
  return client;
}

describe("serveMcpOverStdio", () => {
  it("serves the tools until the MCP client ends its input, then closes the engine client", async () => {
    const engine = createFakeProtocolClient({
      "intent/propose": proposedIntent("awaiting_confirmation"),
    });
    const logger = createRecordingLogger();
    const { toServer, fromServer, streams } = pipes();
    const served = serveMcpOverStdio(
      { client: engine, version: "0.0.0", logger, streams },
      new AbortController().signal,
    );
    const mcp = await connectClient(toServer, fromServer);
    const answer = await mcp.callTool({ name: "binference_propose", arguments: swapArgs });
    expect(firstText(answer)).toContain(fixtureIds.intent);
    expect(engine.status().state).toBe("ready");
    toServer.end();
    await served;
    await mcp.close();
    expect(engine.status().state).toBe("closed");
    expect(logger.records.map((record) => record.event)).toStrictEqual(["mcp.closed"]);
  });

  it("stops when its signal aborts", async () => {
    const engine = createFakeProtocolClient({});
    const stop = new AbortController();
    const { streams } = pipes();
    const served = serveMcpOverStdio(
      { client: engine, version: "0.0.0", logger: createRecordingLogger(), streams },
      stop.signal,
    );
    stop.abort();
    await served;
    expect(engine.status().state).toBe("closed");
  });

  it("lists the tools while the engine refuses to connect, and logs the refusal", async () => {
    const engine = createFakeProtocolClient({}, codedError("auth.invalid", "Unknown token."));
    const logger = createRecordingLogger();
    const { toServer, fromServer, streams } = pipes();
    const served = serveMcpOverStdio(
      { client: engine, version: "0.0.0", logger, streams },
      new AbortController().signal,
    );
    const mcp = await connectClient(toServer, fromServer);
    const { tools } = await mcp.listTools();
    const args = { intent: fixtureIds.intent };
    const answer = await mcp.callTool({ name: "binference_intent_status", arguments: args });
    toServer.end();
    await served;
    await mcp.close();
    expect(tools).toHaveLength(12);
    expect(firstText(answer)).toContain("auth.invalid");
    expect(logger.records.slice(0, 1)).toStrictEqual([
      { level: "warn", event: "mcp.engine_unreachable", errorCode: "auth.invalid" },
    ]);
  });
});
