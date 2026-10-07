import { mcpTools, type ResultOf } from "@binference/protocol";
import { Client } from "@modelcontextprotocol/client";
import { InMemoryTransport } from "@modelcontextprotocol/server";
import { describe, expect, it } from "vitest";
import { createMcpServer } from "../server/create-mcp-server.js";
import {
  codedError,
  createFakeProtocolClient,
  type FakeAnswers,
  type FakeProtocolClient,
} from "../testing/fake-protocol-client.js";
import { createRecordingLogger, type RecordingLogger } from "../testing/recording-logger.js";
import { fixtureIds, portfolio, proposedIntent, swapArgs } from "../testing/wire-fixtures.js";

interface Session {
  readonly mcp: Client;
  readonly engine: FakeProtocolClient;
  readonly logger: RecordingLogger;
}

// An MCP client and the server in one process, over a linked pair of in-memory transports.
async function withSession(answers: FakeAnswers, test: (session: Session) => Promise<void>) {
  const engine = createFakeProtocolClient(answers);
  const logger = createRecordingLogger();
  const server = createMcpServer({ client: engine, version: "2026.10.0", logger });
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await server.connect(serverSide);
  const mcp = new Client({ name: "in-process", version: "1.0.0" });
  await mcp.connect(clientSide);
  try {
    await test({ mcp, engine, logger });
  } finally {
    await mcp.close();
    await server.close();
  }
}

type ToolAnswer = Awaited<ReturnType<Client["callTool"]>>;

function textsOf(answer: ToolAnswer): readonly string[] {
  return answer.content.map((block) => (block.type === "text" ? block.text : block.type));
}

// The JSON a tool answers with: its last text block.
function jsonOf(answer: ToolAnswer): unknown {
  return JSON.parse(textsOf(answer).at(-1) ?? "null");
}

function parsed(text: string): unknown {
  return JSON.parse(text);
}

describe("createMcpServer", () => {
  it("lists the protocol's tools with their texts, object inputs and read-only marks", async () => {
    await withSession({}, async ({ mcp }) => {
      const { tools } = await mcp.listTools();
      expect(tools.map((tool) => tool.name)).toStrictEqual(mcpTools.map((tool) => tool.name));
      const propose = tools.find((tool) => tool.name === "binference_propose");
      expect(propose?.title).toBe("Propose an intent");
      expect(propose?.description).toContain("no tool can confirm");
      expect(propose?.inputSchema.required).toStrictEqual(["agent", "reason", "kind"]);
      expect(propose?.annotations?.readOnlyHint).toBe(false);
      const quote = tools.find((tool) => tool.name === "binference_quote");
      expect(quote?.annotations?.readOnlyHint).toBe(true);
    });
  });

  it("names the server and tells the model that every proposal waits for the owner", async () => {
    await withSession({}, async ({ mcp }) => {
      expect(mcp.getServerVersion()).toMatchObject({ name: "binference", version: "2026.10.0" });
      expect(mcp.getInstructions()).toContain("no tool can confirm");
    });
  });

  it("answers a proposal with the intent id, the waiting text and the intent as JSON", async () => {
    const answers = { "intent/propose": proposedIntent("awaiting_confirmation") };
    await withSession(answers, async ({ mcp, engine }) => {
      const answer = await mcp.callTool({ name: "binference_propose", arguments: swapArgs });
      expect(textsOf(answer)[0]).toBe(
        `Intent ${fixtureIds.intent} is waiting for the owner's confirmation in Telegram or the console.`,
      );
      expect(jsonOf(answer)).toMatchObject({
        intent: fixtureIds.intent,
        state: "awaiting_confirmation",
        request: { amount: { base: "1500000000000000000" } },
      });
      const reached = engine.calls.map((call) => [call.op, parsed(call.args)]);
      expect(reached).toStrictEqual([["intent/propose", swapArgs]]);
    });
  });

  it("names the state and reason of a proposal the engine refused", async () => {
    const answers = { "intent/propose": proposedIntent("rejected_policy", "daily_cap") };
    await withSession(answers, async ({ mcp }) => {
      const answer = await mcp.callTool({ name: "binference_propose", arguments: swapArgs });
      expect(textsOf(answer)[0]).toBe(
        `Intent ${fixtureIds.intent} is in state rejected_policy with reason daily_cap.`,
      );
    });
  });

  it("answers a read with the engine's JSON alone, amounts as decimal strings", async () => {
    await withSession({ "portfolio/get": portfolio() }, async ({ mcp, engine }) => {
      const args = { agent: fixtureIds.agent };
      const answer = await mcp.callTool({ name: "binference_portfolio", arguments: args });
      expect(textsOf(answer)).toHaveLength(1);
      expect(jsonOf(answer)).toMatchObject({
        balances: [{ amount: { base: "1500000000000000000" }, usdMicros: "900000000" }],
      });
      expect(engine.calls.map((call) => call.op)).toStrictEqual(["portfolio/get"]);
    });
  });

  it("refuses args the operation's schema refuses and never calls the engine", async () => {
    await withSession({}, async ({ mcp, engine }) => {
      const send = { ...swapArgs, kind: "send", amount: 1.5 };
      const answer = await mcp.callTool({ name: "binference_propose", arguments: send });
      expect(answer.isError).toBe(true);
      expect(engine.calls).toStrictEqual([]);
    });
  });

  it("refuses a tool outside the table, so no client can confirm through it", async () => {
    await withSession({}, async ({ mcp, engine }) => {
      const confirm = { name: "binference_confirm", arguments: { intent: fixtureIds.intent } };
      await expect(mcp.callTool(confirm)).rejects.toThrow("binference_confirm not found");
      expect(engine.calls).toStrictEqual([]);
    });
  });

  it("answers a refusal with its code, its message and the next step, and logs the code", async () => {
    const refused = codedError("auth.revoked", "The token was revoked.");
    await withSession({ "intent/get": refused }, async ({ mcp, logger }) => {
      const args = { intent: fixtureIds.intent };
      const answer = await mcp.callTool({ name: "binference_intent_status", arguments: args });
      expect(answer.isError).toBe(true);
      expect(textsOf(answer)[0]).toBe(
        "binference_intent_status failed with auth.revoked: The token was revoked. The engine refused the MCP token. Create a new one with `binference token create --for mcp`, then restart the MCP client.",
      );
      expect(logger.records).toStrictEqual([
        { level: "warn", event: "mcp.tool_failed", errorCode: "auth.revoked" },
      ]);
    });
  });

  it("answers a result that breaks its schema as a bad reply", async () => {
    const broken = { balances: "none" } as unknown as ResultOf<"portfolio/get">;
    await withSession({ "portfolio/get": broken }, async ({ mcp }) => {
      const answer = await mcp.callTool({ name: "binference_portfolio", arguments: {} });
      expect(textsOf(answer)).toStrictEqual([
        "binference_portfolio failed with client.bad_reply: The result of portfolio/get breaks its schema.",
      ]);
    });
  });

  it("answers an error without a code as an internal error and keeps its message out", async () => {
    await withSession({ "intent/get": new Error("connect ECONNREFUSED") }, async ({ mcp }) => {
      const args = { intent: fixtureIds.intent };
      const answer = await mcp.callTool({ name: "binference_intent_status", arguments: args });
      expect(textsOf(answer)).toStrictEqual([
        "binference_intent_status failed with internal.error: The MCP server failed to answer this call.",
      ]);
    });
  });
});
