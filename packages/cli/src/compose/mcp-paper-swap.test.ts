import type { ProtocolClient } from "@binference/client";
import { BinferenceError, type Id } from "@binference/core";
import { createMemoryLogger } from "@binference/core/testing";
import { walkLedgerChain } from "@binference/engine";
import {
  testAgent as agent,
  testCoin as coin,
  testNowMs as nowMs,
  testToken as token,
  testWallet as wallet,
} from "@binference/engine/testing";
import { createMcpServer } from "@binference/mcp";
import { createBotThrottlers } from "@binference/telegram";
import {
  createFakeBotApi,
  createMemoryCardCopyStore,
  createMemoryOwnerStore,
  type FakeBotApi,
  fakeBotToken,
} from "@binference/telegram/testing";
import { Client } from "@modelcontextprotocol/client";
import { InMemoryTransport } from "@modelcontextprotocol/server";
import { Api } from "grammy";
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import type { ComposedTelegram } from "./compose-telegram.js";
import {
  type Skeleton,
  type SkeletonComposition,
  skeletonCompositions,
  skeletonSecrets,
  startSkeleton,
} from "./test-skeleton.js";

const live = (): { readonly signal: AbortSignal } => ({ signal: AbortSignal.timeout(10_000) });
// The owner's numeric Telegram id, paired a minute before the test starts.
const ownerId = 7_012_345_678;
// The status icons of spec 4, from their code points: code and tests carry no emojis.
const icons = {
  waiting: String.fromCodePoint(0x1f7e1),
  done: String.fromCodePoint(0x2705),
  refused: String.fromCodePoint(0x274c),
  paper: String.fromCodePoint(0x1f9ea),
};

// "Swap 0.01 BNB to USDT" on the fake chain: 0.01 of its coin, which pays gas as BNB does, for
// the token it lists. The MCP client sends a request id, so a retry makes no second card.
const proposal = {
  kind: "swap",
  agent,
  wallet,
  reason: "The owner asked to swap 0.01 BNB to USDT",
  from: coin,
  to: token,
  amount: { base: "10000000000000000" },
  requestId: "0190f1c2-3a4b-7c5d-8e6f-0000000000aa",
};
// The fake venue quotes two of the token for one of the coin, at most 0.5% slippage.
const quoted = {
  amountIn: { asset: coin, base: "10000000000000000" },
  expectedOut: { asset: token, base: "20000000000000000" },
  minOut: { asset: token, base: "19900000000000000" },
};

/** An MCP client in the place of Claude Code or Codex, and the MCP server it talks to. */
interface McpSession {
  readonly mcp: Client;
  close(): Promise<void>;
}

/** The skeleton with the owner's bot on the synthetic Bot API, and an MCP session. */
interface FullSkeleton {
  readonly skeleton: Skeleton;
  readonly telegram: ComposedTelegram;
  readonly botApi: FakeBotApi;
  readonly session: McpSession;
}

type ToolAnswer = Awaited<ReturnType<Client["callTool"]>>;

const proposedSchema = z.object({ intent: z.string() });

function textsOf(answer: ToolAnswer): readonly string[] {
  return answer.content.map((block) => (block.type === "text" ? block.text : block.type));
}

// The engine's JSON a tool answers with: its last text block.
function jsonOf(answer: ToolAnswer): unknown {
  return JSON.parse(textsOf(answer).at(-1) ?? "null");
}

// The MCP server signs in to the engine with the MCP token, which holds read and propose only.
async function openMcp(engine: ProtocolClient): Promise<McpSession> {
  const server = createMcpServer({
    client: engine,
    version: "2026.10.0",
    logger: createMemoryLogger({ subsystem: "mcp" }),
  });
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await server.connect(serverSide);
  const mcp = new Client({ name: "claude-code", version: "2.1.291" });
  await mcp.connect(clientSide);
  return {
    mcp,
    async close() {
      await mcp.close();
      await server.close();
    },
  };
}

async function startFull(composition: SkeletonComposition): Promise<FullSkeleton> {
  const botApi = createFakeBotApi();
  const api = new Api(fakeBotToken, { fetch: botApi.fetch });
  const owners = createMemoryOwnerStore();
  await owners.bind({ userId: ownerId, pairedAtMs: nowMs - 60_000 }, live());
  const parts = { api, owners, copies: createMemoryCardCopyStore() };
  const skeleton = await startSkeleton(composition.parts(), { telegram: parts });
  const { telegram } = skeleton.composed;
  if (telegram === undefined) {
    throw new BinferenceError({ code: "test.no_bot", message: "The skeleton serves the bot." });
  }
  const logger = createMemoryLogger({ subsystem: "telegram" });
  createBotThrottlers({ clock: skeleton.clock, logger }).install(api);
  const engine = await skeleton.connect(skeletonSecrets.mcp, "mcp");
  return { skeleton, telegram, botApi, session: await openMcp(engine) };
}

// Proposes the swap twice with one request id, as a client that retries after a timeout.
async function proposeTwice(full: FullSkeleton): Promise<Id<"int">> {
  const call = { name: "binference_propose", arguments: proposal };
  const first = await full.session.mcp.callTool(call);
  const retried = await full.session.mcp.callTool(call);
  const { intent } = proposedSchema.parse(jsonOf(first));
  expect(first.isError).toBeUndefined();
  expect(textsOf(first)[0]).toBe(
    `Intent ${intent} is waiting for the owner's confirmation in Telegram or the console.`,
  );
  expect(jsonOf(first)).toMatchObject({
    agent,
    wallet,
    state: "awaiting_confirmation",
    paper: true,
    quote: quoted,
    card: { version: 1, paper: true },
  });
  expect(jsonOf(retried)).toStrictEqual(jsonOf(first));
  return intent as Id<"int">;
}

async function callbackRefOf(full: FullSkeleton, intent: Id<"int">): Promise<string> {
  const cards = await full.skeleton.parts.stores.intents.cards(intent, live());
  expect(cards).toHaveLength(1);
  return cards[0]?.callbackRef ?? "";
}

describe.each(skeletonCompositions)(
  "a paper swap from an MCP client to a Telegram tap on the $name composition",
  (composition) => {
    let full: FullSkeleton | undefined;

    afterEach(async () => {
      await full?.session.close();
      await full?.skeleton.close();
      full = undefined;
    });

    it(
      "shows the card in Telegram, fills on the owner's tap and gives the MCP client the fill",
      { timeout: 60_000 },
      async () => {
        full = await startFull(composition);
        const { skeleton, telegram, botApi, session } = full;
        await skeleton.client.call("portfolio/resetPaper", { agent }, live());
        const intent = await proposeTwice(full);

        await telegram.idle();
        const ref = await callbackRefOf(full, intent);
        expect(botApi.messages()).toStrictEqual([
          {
            chatId: ownerId,
            messageId: 1001,
            text: [
              `${icons.waiting} Confirm swap · main · ${icons.paper} Paper`,
              "Sell 0.01 FAKE → at least 19,900,000,000 TKN",
              "Route  fake-swap: fake-swap 100.00% · impact 0.10% · max slippage 0.50%",
              `Check  ${icons.done} simulation: you receive 20,000,000,000 TKN · ${icons.done} TKN verified`,
              `${icons.paper} Paper mode: nothing is sent on chain`,
              'Agent says  "The owner asked to swap 0.01 BNB to USDT"',
              "Expires at 08:01:00",
            ].join("\n"),
            entities: [],
            buttons: [
              [
                { text: `${icons.done} Confirm`, data: `bnf1:c:y:${ref}` },
                { text: `${icons.refused} Cancel`, data: `bnf1:c:n:${ref}` },
              ],
            ],
          },
        ]);

        // A second later the owner taps Confirm, and the bot's update intake takes the press.
        await skeleton.clock.advance(1_000);
        const tap = botApi.press({ from: ownerId, data: `bnf1:c:y:${ref}`, messageId: 1001 });
        await telegram.ingress.receive(tap, live());
        await telegram.idle();
        expect(botApi.messages()).toMatchObject([
          { text: `${icons.paper} Paper fill: 0.01 FAKE → 20,000,000,000 TKN`, buttons: [] },
        ]);
        expect(botApi.answers()).toStrictEqual([{ callbackId: "press-9001" }]);

        const status = await session.mcp.callTool({
          name: "binference_intent_status",
          arguments: { intent },
        });
        const fill = {
          amountIn: quoted.amountIn,
          amountOut: quoted.expectedOut,
          at: nowMs + 1_000,
        };
        expect(jsonOf(status)).toMatchObject({
          intent,
          state: "paper_filled",
          outcome: { executions: [fill] },
        });

        const ledger = await session.mcp.callTool({ name: "binference_ledger", arguments: {} });
        const tapped = { surface: "telegram", by: `tg:${String(ownerId)}` };
        expect(jsonOf(ledger)).toMatchObject({
          items: [
            { seq: 1, kind: "proposed", subject: intent, data: { proposer: "mcp_client" } },
            { seq: 2, kind: "awaiting_confirmation", subject: intent },
            {
              seq: 3,
              kind: "confirmed",
              subject: intent,
              data: { closing: { outcome: "confirmed", answeredBy: tapped } },
            },
            {
              seq: 4,
              kind: "paper_filled",
              subject: intent,
              data: { fill: { amountIn: quoted.amountIn, amountOut: quoted.expectedOut } },
            },
          ],
        });
        await expect(
          walkLedgerChain(skeleton.parts.stores.ledger, {}, live()),
        ).resolves.toMatchObject({ ok: true, value: { seq: 4 } });
        const confirmation = await skeleton.parts.stores.intents.confirmation(intent, live());
        expect(confirmation).toMatchObject({ bySurface: "telegram", byRef: tapped.by });
        const held = await skeleton.positions.positions(
          { walletId: wallet, isPaper: true },
          live(),
        );
        expect(held.map((row) => [row.asset, row.quantityBase])).toStrictEqual([
          [coin, 10n ** 18n - 10n ** 16n],
          [token, 2n * 10n ** 16n],
        ]);
        expect(skeleton.executor.taken()).toStrictEqual([]);
      },
    );
  },
);
