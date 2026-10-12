import {
  type AccountRef,
  accountRefSchema,
  type SimulatedStep,
  type TxSimulator,
} from "@binference/chain";
import { createFakeFamily, createFakeTxSimulator } from "@binference/chain/testing";
import { BinferenceError, createSecret, idSchema, type JsonValue, ok } from "@binference/core";
import type { ModelCharge } from "@binference/engine";
import {
  createMemoryCardCopyStore,
  createMemoryOwnerStore,
  testAgent,
  testCoin,
  testNowMs,
} from "@binference/engine/testing";
import {
  createFakeBotApi,
  type FakeBotApi,
  type FakeMessage,
  fakeBotToken,
  ownerCallsContract,
} from "@binference/telegram/testing";
import { Api } from "grammy";
import { describe, expect, it } from "vitest";
import { currentConfigVersion } from "../config/migrations/config-migrations.js";
import { configSchema } from "../config/schema/config.schema.js";
import type { ComposedTelegram } from "./compose-telegram.js";
import { createOwnerLocaleChange } from "./owner-locale-change.js";
import {
  type ComposedSkeleton,
  composeSkeleton,
  type SkeletonOptions,
  skeletonCompositions,
} from "./test-skeleton.js";

const live = { signal: new AbortController().signal };
const ownerId = 7_012_345_678;
const dayMs = 86_400_000;
const [selfHosted] = skeletonCompositions;
// The test wallet's account in the skeleton, and the owner's rescue address on the same chain.
const walletAccount: AccountRef = accountRefSchema.parse("fake:1:0x0000000c");
const rescueAccount: AccountRef = accountRefSchema.parse("fake:1:0x000000a1");
// The test agent keeps 10^15 of the coin for gas, so a rescue moves the rest of one coin.
const moved = { asset: testCoin, base: 10n ** 18n - 10n ** 15n };
const alarm = String.fromCodePoint(0x1f534);

/** The composed engine with the owner's bot on the synthetic Bot API. */
interface Bot extends ComposedSkeleton {
  readonly telegram: ComposedTelegram;
  readonly botApi: FakeBotApi;
  /** Sends a text from the owner, as Telegram delivers it, and waits until it is handled. */
  send(text: string): Promise<void>;
}

function never(): never {
  throw new BinferenceError({ code: "test.missing", message: "The fixture holds it." });
}

// The rescue's one send, the coin above the reserve, runs as planned.
function rescueSimulator(): TxSimulator {
  const draft = createFakeFamily().transferDraft({
    from: walletAccount,
    to: rescueAccount,
    amount: moved,
  });
  const step: SimulatedStep = {
    status: "success",
    gasUsed: 21_000n,
    transfers: [{ from: walletAccount, to: rescueAccount, amount: moved }],
    approvals: [],
  };
  return createFakeTxSimulator(new Map([[draft.ok ? draft.value.payload : never(), step]]));
}

// The one message with buttons: the card the owner taps.
function cardOf(botApi: FakeBotApi): FakeMessage {
  const [card, ...others] = botApi.messages().filter((message) => message.buttons.length > 0);
  return card !== undefined && others.length === 0 ? card : never();
}

// The data of a card's Confirm button, the first of its one row.
function confirmDataOf(card: FakeMessage): string {
  return card.buttons[0]?.[0]?.data ?? never();
}

// A config as the self-hosted engine runs on it, for the answer of a language change.
function skeletonConfig() {
  return configSchema.parse({
    version: currentConfigVersion,
    telegram: { botToken: { fromEnv: "TEST_BOT_TOKEN" } },
  });
}

// The agent's per-trade cap as the store keeps it.
async function perTradeOf(test: Bot): Promise<bigint> {
  const settings = await test.parts.stores.agents.get(testAgent, live);
  return settings?.limits.perTradeUsdMicros ?? never();
}

// The message `/lang` answered with, which carries its buttons.
function langMessageOf(botApi: FakeBotApi): number {
  const message = botApi.messages().find((sent) => sent.text.startsWith("binference uses"));
  return message?.messageId ?? never();
}

// The message `/limits` answered with, which carries its buttons.
function limitsMessageOf(botApi: FakeBotApi): number {
  const message = botApi.messages().find((sent) => sent.text.startsWith("Limits of"));
  return message?.messageId ?? never();
}

function textFrom(updateId: number, text: string): JsonValue {
  return {
    update_id: updateId,
    message: {
      message_id: updateId + 500,
      date: 1_760_000_000,
      chat: { id: ownerId, type: "private" },
      from: { id: ownerId, is_bot: false, first_name: "Owner" },
      text,
    },
  };
}

// The skeleton with one coin in its wallet and a rescue address in effect, and the owner's bot.
async function bot(
  ownerChat: SkeletonOptions["ownerChat"] = {},
  published: { readonly miniAppUrl?: string } = {},
): Promise<Bot> {
  const botApi = createFakeBotApi();
  const owners = createMemoryOwnerStore();
  await owners.bind({ userId: ownerId, pairedAtMs: 1 }, live);
  const api = new Api(fakeBotToken, { fetch: botApi.fetch });
  const telegram = {
    api,
    owners,
    copies: createMemoryCardCopyStore(),
    botToken: createSecret(fakeBotToken),
    ...published,
  };
  const skeleton = await composeSkeleton(selfHosted?.parts() ?? never(), {
    telegram,
    held: new Map([[walletAccount, [{ asset: testCoin, base: 10n ** 18n }]]]),
    chainSimulator: rescueSimulator(),
    ownerChat,
  });
  const change = { address: rescueAccount, atMs: testNowMs - 2 * dayMs };
  await skeleton.parts.stores.install.changeRescue(change, live);
  const composed = skeleton.composed.telegram ?? never();
  composed.start();
  await composed.idle();
  let updateId = 0;
  return {
    ...skeleton,
    telegram: composed,
    botApi,
    send: async (text) => {
      updateId += 1;
      await composed.ingress.receive(textFrom(updateId, text), live);
      await composed.idle();
    },
  };
}

describe("the owner's fast commands on the engine", () => {
  it.each(
    ownerCallsContract({
      create: async () => ({ calls: (await bot()).telegram.calls, ownerId }),
    }),
  )("runs the owner's calls as the owner calls contract says: $name", async ({ run }) => {
    await expect(run()).resolves.toBeUndefined();
  });

  it("opens the Mini App from /console at the published address", async () => {
    const test = await bot({}, { miniAppUrl: "https://owner.example.ts.net/mini" });
    await test.send("/console");
    const buttons = test.botApi.messages().flatMap((message) => message.buttons.flat());
    expect(buttons.map((button) => button.text)).toStrictEqual(["Open the console"]);
    expect(buttons[0]?.webApp).toMatch(
      /^https:\/\/owner\.example\.ts\.net\/mini#ticket=[\w-]{43}$/,
    );
  });

  it("answers /spend with the usage the engine stored, by day and model", async () => {
    const test = await bot();
    const turn = idSchema("trn").parse("trn_0190f1c2-3a4b-7c5d-8e6f-000000000001");
    const tokens = { inputTokens: 1_000, outputTokens: 100, cachedTokens: 0 };
    const attempt = (n: number, spent: Pick<ModelCharge, "model" | "usdMicros" | "atMs">) => ({
      ...tokens,
      ...spent,
      agent: testAgent,
      turn,
      key: `${turn}.usage.${String(n)}`,
    });
    const usage = test.parts.stores.modelUsage;
    const [gpt, sonnet] = ["openai/gpt-5.4", "anthropic/claude-sonnet-4-6"];
    await usage.record(
      attempt(1, { model: gpt, usdMicros: 1_000_000n, atMs: testNowMs - 3 * dayMs }),
      live,
    );
    await usage.record(attempt(2, { model: gpt, usdMicros: 250_000n, atMs: testNowMs - 1 }), live);
    await usage.record(
      attempt(3, { model: sonnet, usdMicros: 1_000_000n, atMs: testNowMs - 2 }),
      live,
    );
    await test.send("/spend");

    expect(test.botApi.sent().map((sent) => sent.text)).toStrictEqual([
      [
        `${testAgent}: $1.25 of today's $5.00 model budget spent, $3.75 left`,
        "This month: $2.25",
        "openai/gpt-5.4: $1.25 this month",
        "anthropic/claude-sonnet-4-6: $1.00 this month",
      ].join("\n"),
    ]);
  });

  it("freezes every agent from Telegram, and the engine says Telegram did", async () => {
    const test = await bot();
    await test.send("/freeze");
    const frozen = await test.parts.stores.agents.get(testAgent, live);
    expect(frozen?.agent.frozenAtMs).toBe(testNowMs);
    expect(test.botApi.sent().map((sent) => sent.text)).toStrictEqual([
      expect.stringMatching(new RegExp(`^${alarm} Every agent is frozen`)),
      `${alarm} main is frozen from Telegram. Unfreeze in the CLI, the console or the Mini App.`,
    ]);
  });

  it("opens the rescue card while every agent is frozen, and a tap sends the rescue on", async () => {
    const test = await bot();
    await test.send("/freeze");
    await test.send("/rescue");
    const card = cardOf(test.botApi);
    expect(card.text).toContain("Move everything to your rescue address 0x000000a1");
    const press = { from: ownerId, data: confirmDataOf(card), messageId: card.messageId };
    await test.telegram.ingress.receive(test.botApi.press(press), live);
    await test.telegram.idle();
    const taken = await Promise.all(
      test.executor.taken().map(async (intent) => test.parts.stores.intents.get(intent, live)),
    );
    expect(taken.map((record) => [record?.kind, record?.state])).toStrictEqual([
      ["rescue", "confirmed"],
    ]);
  });

  it("halves the per-trade cap at a tap of /limits, at once and announced, and again at the next", async () => {
    const test = await bot();
    const before = await perTradeOf(test);
    await test.send("/limits");
    const message = limitsMessageOf(test.botApi);
    const halve = { from: ownerId, data: "bnf1:t:h:perTradeUsdMicros", messageId: message };
    await test.telegram.ingress.receive(test.botApi.press(halve), live);
    await test.telegram.ingress.receive(test.botApi.press(halve), live);
    await test.telegram.idle();
    expect(await perTradeOf(test)).toBe(before / 4n);
    expect(
      test.botApi
        .sent()
        .map((sent) => sent.text)
        .filter((text) => text.startsWith("main · Limit changed")),
    ).toStrictEqual([
      "main · Limit changed by Telegram: the per-trade cap changed now",
      "main · Limit changed by Telegram: the per-trade cap changed now",
    ]);
  });

  it("sets the owner's language in the config file at a tap of /lang, and nothing else", async () => {
    const disk = { text: '{\n  // Mine.\n  owner: { locale: "en" },\n}\n' };
    const test = await bot({
      "config/change": createOwnerLocaleChange({
        file: "config.json5",
        permissions: {} as never,
        settings: { current: () => skeletonConfig() },
        readFile: async () => Promise.resolve(ok(disk.text)),
        writeFile: async (_path, data) => {
          disk.text = String(data);
          await Promise.resolve();
        },
      }),
    });
    await test.send("/lang");
    const press = { from: ownerId, data: "bnf1:l:s:zh", messageId: langMessageOf(test.botApi) };
    await test.telegram.ingress.receive(test.botApi.press(press), live);
    expect(disk.text).toBe('{\n  // Mine.\n  owner: { locale: "zh" },\n}\n');
  });

  it.each([
    ["/status", "binference 2026.10.0 is running."],
    ["/limits", `Limits of ${testAgent} in effect now:`],
    ["/paper", `${String.fromCodePoint(0x1f9ea)} `],
    ["/balance", "No agent wallet holds anything yet."],
    ["/orders", "No active auto orders."],
    ["/cancel", "Nothing waits for your confirmation, so there is nothing to cancel."],
  ])("answers %s from the engine with no agent runtime", async (command, start) => {
    const test = await bot();
    await test.send(command);
    expect(test.botApi.sent()[0]?.text.startsWith(start)).toBe(true);
  });
});
