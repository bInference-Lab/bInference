import { PassThrough } from "node:stream";
import { createMemoryLogger } from "@binference/core/testing";
import { serveMcpOverStdio } from "@binference/mcp";
import { Client } from "@modelcontextprotocol/client";
import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";
import { afterEach, describe, expect, it } from "vitest";
import { createMcpRecorder, type RecordedCall } from "./mcp-recorder.js";
import { type SkillRunEngine, skillRunIds, startSkillRunEngine } from "./skill-run-engine.js";
import { skillRunVerdict } from "./skill-run-verdict.js";

interface Served {
  readonly engine: SkillRunEngine;
  readonly mcp: Client;
  readonly changes: (readonly RecordedCall[])[];
  readonly calls: () => readonly RecordedCall[];
  close(): Promise<void>;
}

// The run's MCP server over pipes with the recorder between, and an MCP client in the place of
// Claude Code on the pipes' other ends, as the stdio tests of the MCP server connect.
async function serve(): Promise<Served> {
  const engine = await startSkillRunEngine();
  const toServer = new PassThrough();
  const fromServer = new PassThrough();
  const changes: (readonly RecordedCall[])[] = [];
  const recorder = createMcpRecorder({ input: toServer, output: fromServer }, (calls) => {
    changes.push(calls);
  });
  const logger = createMemoryLogger({ subsystem: "mcp" });
  const served = serveMcpOverStdio(
    { client: engine.mcpClient, version: "test", logger, streams: recorder.streams },
    new AbortController().signal,
  );
  const mcp = new Client({ name: "claude-code", version: "2.1.291" });
  await mcp.connect(new StdioServerTransport(fromServer, toServer));
  return {
    engine,
    mcp,
    changes,
    calls: () => recorder.calls(),
    async close() {
      toServer.end();
      await served;
      await mcp.close();
      await engine.close();
    },
  };
}

// The engine's JSON a tool answers with: its last text block.
function jsonOf(call: RecordedCall | undefined): unknown {
  return JSON.parse(String(call?.answer?.texts.at(-1)));
}

const swap = {
  kind: "swap",
  agent: skillRunIds.agent,
  from: skillRunIds.bnb,
  to: skillRunIds.usdt,
  amount: { base: "10000000000000000" },
  reason: "The owner asked to swap 0.01 BNB to USDT.",
  requestId: "0190f1c2-3a4b-7c5d-8e6f-0000000000bb",
};

describe("the recorded run's MCP server", () => {
  let served: Served | undefined;

  afterEach(async () => {
    await served?.close();
    served = undefined;
  });

  it("shows BNB and USDT on paper and records a proposal of the swap as passing", async () => {
    served = await serve();
    const portfolio = await served.mcp.callTool({ name: "binference_portfolio", arguments: {} });
    await served.mcp.callTool({ name: "binference_propose", arguments: swap });

    const [portfolioCall, proposal] = served.calls();
    expect(portfolio.isError).toBeUndefined();
    expect(jsonOf(portfolioCall)).toMatchObject({
      balances: [
        { wallet: skillRunIds.wallet, amount: { asset: skillRunIds.bnb }, paper: true },
        { wallet: skillRunIds.wallet, amount: { asset: skillRunIds.usdt }, paper: true },
      ],
      assets: {
        [skillRunIds.bnb]: { symbol: "BNB", decimals: 18 },
        [skillRunIds.usdt]: { symbol: "USDT", decimals: 18, verified: true },
      },
    });
    expect(proposal).toMatchObject({ tool: "binference_propose", arguments: swap });
    expect(proposal?.answer?.isError).toBe(false);
    expect(proposal?.answer?.texts[0]).toMatch(
      /^Intent int_\S+ is waiting for the owner's confirmation in Telegram or the console\.$/,
    );
    expect(served.changes.map((calls) => calls.length)).toStrictEqual([1, 1, 2, 2]);
    expect(skillRunVerdict(served.calls(), skillRunIds)).toStrictEqual({
      passed: true,
      problems: [],
    });
  }, 30_000);

  it("records a refused call as an error answer", async () => {
    served = await serve();
    const unknownAgent = { ...swap, agent: "agt_0190f1c2-3a4b-7c5d-8e6f-0000000000ff" };
    await served.mcp.callTool({ name: "binference_propose", arguments: unknownAgent });
    const [proposal] = served.calls();
    expect(proposal?.answer?.isError).toBe(true);
    expect(skillRunVerdict(served.calls(), skillRunIds).passed).toBe(false);
  }, 30_000);
});
