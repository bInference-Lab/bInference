import { createFakeRiskSource } from "@binference/chain/testing";
import { BinferenceError, bpsSchema, createSecret, type Id } from "@binference/core";
import type { EngineCaller } from "@binference/engine";
import type { RunningTurns } from "@binference/engine/chat";
import {
  createFakeTokenFacts,
  createMemoryCardCopyStore,
  createMemoryOwnerStore,
  createTokenModelSimulator,
  testAgent as agent,
  testCoin as coin,
  testToken as token,
  testWallet as wallet,
  unknownToken,
} from "@binference/engine/testing";
import type { IntentRequest, OrderRequest, OwnerInfo } from "@binference/protocol";
import { createFakeBotApi, type FakeBotApi, fakeBotToken } from "@binference/telegram/testing";
import { Api } from "grammy";
import type { ComposedTelegram } from "./compose-telegram.js";
import { type ComposedSkeleton, composeSkeleton, skeletonCompositions } from "./test-skeleton.js";

const live = { signal: new AbortController().signal };

/** The owner's numeric Telegram id, paired with the test bot. */
export const ownerId = 7_012_345_678;

// The CLI, with every scope, and an MCP client, which reads and proposes.
const callers: Readonly<Record<"cli" | "mcp", EngineCaller>> = {
  cli: {
    credential: "tok_0190f1c2-3a4b-7c5d-8e6f-000000000001",
    client: { kind: "cli", version: "test" },
    scopes: ["read", "propose", "chat", "confirm", "loosen", "admin"],
  },
  mcp: {
    credential: "tok_0190f1c2-3a4b-7c5d-8e6f-000000000002",
    client: { kind: "mcp", version: "test" },
    scopes: ["read", "propose"],
  },
};

const swap: IntentRequest = {
  kind: "swap",
  agent,
  wallet,
  reason: "Rotate into the token",
  from: coin,
  to: token,
  amount: { base: 10n ** 16n },
};
const [selfHosted] = skeletonCompositions;
// A token the registry does not list: on chain it answers XVS with 18 decimals, the one risk
// source finds it clean, and its round trip moves it untaxed.
const unlistedFacts = new Map([[unknownToken, { symbol: "XVS", name: "Venus", decimals: 18 }]]);
const cleanUnlisted = new Map([[unknownToken, { flags: [], liquidityUsdMicros: 10n ** 15n }]]);

/** A buy of 0.01 of the coin's worth of the unlisted token, which answers XVS on chain. */
export const buyUnlisted: IntentRequest = {
  kind: "buy",
  agent,
  wallet,
  reason: "Buy the token",
  token: unknownToken,
  spend: { asset: coin, base: 10n ** 16n },
};

/** A stop-loss that sells all of the unlisted token at $0.80. */
export const stopLossUnlisted: OrderRequest = {
  kind: "stopLoss",
  agent,
  token: unknownToken,
  side: "sell",
  size: { percentBps: bpsSchema.parse(10_000) },
  trigger: { price: 800_000n },
  reason: "Protect the position",
};

/** The composed engine with the owner's bot on the synthetic Bot API, the paper money opened. */
export interface Bot extends ComposedSkeleton {
  readonly telegram: ComposedTelegram;
  readonly botApi: FakeBotApi;
}

/** How a test bot differs from the default: paired, English in UTC, no runtime. */
export interface BotOptions {
  readonly isPaired?: boolean;
  readonly owner?: () => OwnerInfo;
  readonly turns?: RunningTurns;
  /** The engine reads the unlisted token's facts on chain and the risk source finds it clean. */
  readonly knowsUnlisted?: boolean;
}

/** Fails a test whose fixture lacks what it needs. */
export function never(): never {
  throw new BinferenceError({ code: "test.missing", message: "The fixture holds it." });
}

// The profile parts, with a risk source that finds the unlisted token clean when the test trades it.
function partsOf(options: BotOptions) {
  const parts = selfHosted?.parts() ?? never();
  if (options.knowsUnlisted !== true) {
    return parts;
  }
  const source = createFakeRiskSource({ id: "goplus", reports: cleanUnlisted });
  return { ...parts, riskSources: [{ source, isRequired: true }] };
}

// What the engine reads of the unlisted token on chain, and how its round trip runs.
function unlistedParts(options: BotOptions) {
  return options.knowsUnlisted === true
    ? {
        tokenFacts: createFakeTokenFacts({ facts: unlistedFacts }).read,
        chainSimulator: createTokenModelSimulator({}),
      }
    : {};
}

/** The self-hosted skeleton with the owner's bot joined to it, the paper portfolio reset. */
export async function bot(options: BotOptions = {}): Promise<Bot> {
  const botApi = createFakeBotApi();
  const owners = createMemoryOwnerStore();
  if (options.isPaired !== false) {
    await owners.bind({ userId: ownerId, pairedAtMs: 1 }, live);
  }
  const api = new Api(fakeBotToken, { fetch: botApi.fetch });
  const telegram = {
    api,
    owners,
    copies: createMemoryCardCopyStore(),
    botToken: createSecret(fakeBotToken),
  };
  const owner = options.owner === undefined ? {} : { owner: options.owner };
  const turns = options.turns === undefined ? {} : { turns: options.turns };
  const skeleton = await composeSkeleton(partsOf(options), {
    telegram,
    ...owner,
    ...turns,
    ...unlistedParts(options),
  });
  const composed = skeleton.composed.telegram ?? never();
  const { handlers } = skeleton.composed.engine;
  await handlers["portfolio/resetPaper"]({ args: { agent }, caller: callers.cli, ...live });
  return { ...skeleton, telegram: composed, botApi };
}

/** Switches the test agent to auto mode from the CLI, so its cards say why auto mode asks. */
export async function inAutoMode(test: Bot): Promise<void> {
  const args = { args: { agent, mode: "auto" } as const, caller: callers.cli, ...live };
  const set = await test.composed.engine.handlers["approval/set"](args);
  if (!set.ok) {
    never();
  }
}

/** Proposes from the MCP client, a swap into the test token by default, which opens a card. */
export async function propose(
  test: Bot,
  request: IntentRequest = swap,
): Promise<{ readonly intent: Id<"int">; readonly ref: string }> {
  const { handlers } = test.composed.engine;
  const args = { args: request, caller: callers.mcp, ...live };
  const proposed = await handlers["intent/propose"](args);
  const intent = proposed.ok ? proposed.value.intent : never();
  const [card] = await test.parts.stores.intents.cards(intent, live);
  return { intent, ref: card?.callbackRef ?? never() };
}

/** Answers the intent's first card version from the CLI, which must take the answer. */
export async function answerInCli(
  test: Bot,
  intent: Id<"int">,
  verb: "confirm" | "deny",
): Promise<void> {
  const [card] = await test.parts.stores.intents.cards(intent, live);
  const args = { intent, card: card?.id ?? never(), cardVersion: 1 };
  const { handlers } = test.composed.engine;
  const answered = await handlers[`intent/${verb}`]({ args, caller: callers.cli, ...live });
  if (!answered.ok) {
    never();
  }
}

/** Creates an order from the MCP client, which must open its card. */
export async function createOrder(test: Bot, request: OrderRequest): Promise<void> {
  const created = await test.composed.engine.handlers["order/create"]({
    args: request,
    caller: callers.mcp,
    ...live,
  });
  if (!created.ok) {
    never();
  }
}

/** Freezes the test agent from the CLI, then asks for its unfreeze, which opens a card. */
export async function frozenThenUnfreezing(test: Bot): Promise<void> {
  const { handlers } = test.composed.engine;
  const call = { args: { agent }, caller: callers.cli, ...live };
  const frozen = await handlers["safety/freeze"](call);
  const unfreezing = await handlers["safety/unfreeze"](call);
  if (!frozen.ok || !unfreezing.ok) {
    never();
  }
}

/** The owner taps Confirm on the newest card in the chat, through the bot's update intake. */
export async function tapConfirm(test: Bot): Promise<void> {
  await test.telegram.idle();
  const card = test.botApi.messages().findLast((message) => message.buttons.length > 0);
  const data = card?.buttons[0]?.[0]?.data ?? never();
  const messageId = card?.messageId ?? never();
  const tap = test.botApi.press({ from: ownerId, data, messageId });
  await test.telegram.ingress.receive(tap, live);
  await test.telegram.idle();
}
