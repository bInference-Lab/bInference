import type { ProtocolClient } from "@binference/client";
import type { Clock, Http } from "@binference/core";
import { createManualClock, type ManualClock } from "@binference/core/testing";
import type { TempFolder } from "@binference/platform/testing";
import { fakeBotToken } from "@binference/telegram/testing";
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import {
  type InitMachine,
  initFlags,
  newInitMachine,
  runOn,
  secretEnv,
  secretVariables,
} from "./init-fixtures.js";
import { miniAppClient, signedLaunch } from "./mini-app-fixtures.js";
import { engineLogLines, freePort } from "./test-host.js";
import { createRunningEngines } from "./unlock-fixtures.js";

const slow = { timeout: 60_000 };
const engines = createRunningEngines();
const folders: TempFolder[] = [];
// The owner's numeric Telegram id, who opens the pairing link.
const ownerId = 7_012_345_678;
const telegramOrigin = "https://api.telegram.org";
const pairingSchema = z.object({ pairing: z.object({ link: z.url() }) });
const repairingSchema = z.strictObject({ link: z.url(), expiresAt: z.int() });
// The Telegram account `binference telegram pair` pairs in the owner's place.
const nextOwnerId = 7_098_765_432;

// The Mini App clients a test opened, closed before their engine stops.
const minis: ProtocolClient[] = [];

afterEach(async () => {
  minis.splice(0).forEach((client) => client.close());
  await engines.stopAll();
  await Promise.all(folders.splice(0).map(async (folder) => folder.remove()));
});

/** One Bot API call the engine made: its method, its JSON text, and whether Telegram answered. */
interface BotCall {
  readonly method: string;
  readonly body: string;
  readonly isAnswered: boolean;
}

// The machine's world, which hears each Bot API call as it goes out and once Telegram answered.
function watchedWorld(machine: InitMachine) {
  const waiters = new Set<{
    readonly match: (call: BotCall) => boolean;
    readonly done: () => void;
  }>();
  const calls: BotCall[] = [];
  const heard = (call: BotCall): void => {
    calls.push(call);
    [...waiters]
      .filter((waiter) => waiter.match(call))
      .forEach((waiter) => {
        waiters.delete(waiter);
        waiter.done();
      });
  };
  const http: Http = {
    request: async (request) => {
      const url = new URL(request.url);
      if (url.origin !== telegramOrigin) {
        return machine.world.request(request);
      }
      const call = { method: url.pathname.split("/").at(-1) ?? "", body: request.body ?? "" };
      heard({ ...call, isAnswered: false });
      const answer = await machine.world.request(request);
      heard({ ...call, isAnswered: true });
      return answer;
    },
  };
  const until = async (match: (call: BotCall) => boolean): Promise<void> =>
    calls.some(match) ? Promise.resolve() : new Promise((done) => waiters.add({ match, done }));
  return { http, until };
}

const sent = (text: string) => (call: BotCall) =>
  call.method === "sendMessage" && call.isAnswered && call.body.includes(text);

// A message with this text Telegram took for this chat.
const sentTo = (chatId: number, text: string) => (call: BotCall) =>
  sent(text)(call) && call.body.includes(`"chat_id":${String(chatId)}`);

// The start code of a pairing link.
function startCodeOf(link: string): string {
  return new URL(link).searchParams.get("start") ?? "";
}

// The engine's nth long poll for updates, counted from its start.
function poll(nth: number) {
  const seen = { polls: 0 };
  return (call: BotCall): boolean => {
    if (call.method !== "getUpdates" || call.isAnswered) {
      return false;
    }
    seen.polls += 1;
    return seen.polls >= nth;
  };
}

// A text a person types in their private chat with the bot, as Telegram delivers it.
function textFrom(userId: number, updateId: number, text: string) {
  const chat = { id: userId, type: "private" };
  const from = { id: userId, is_bot: false, first_name: "Owner" };
  return { update_id: updateId, message: { message_id: updateId, date: 1, chat, from, text } };
}

// A text the owner types in the bot's private chat.
function ownerText(updateId: number, text: string) {
  return textFrom(ownerId, updateId, text);
}

// A Mini App that signs in with a launch over the engine's WS at `origin`.
function openMini(origin: string, initData: string, clock: Clock): ProtocolClient {
  const client = miniAppClient({ origin, initData, clock });
  minis.push(client);
  return client;
}

interface SetUp {
  readonly machine: InitMachine;
  readonly clock: ManualClock;
  /** The start code of the pairing link init printed. */
  readonly code: string;
}

async function setUp(): Promise<SetUp> {
  const clock = createManualClock(1_800_000_000_000);
  const machine = await newInitMachine(folders, clock);
  const init = await runOn(machine, ["init", "--json", "--yes", ...initFlags(machine)]);
  const { link } = pairingSchema.parse(JSON.parse(init.stdout)).pairing;
  return { machine, clock, code: startCodeOf(link) };
}

describe("the owner's bot in binference start", () => {
  it("registers the menu, pairs the owner, answers a command and sends notices", slow, async () => {
    const { machine, clock, code } = await setUp();
    const world = watchedWorld(machine);
    // The bot's throttler spaces the messages to one chat a second apart on the engine's clock.
    const nextSecond = async (): Promise<void> => clock.advance(1_000);
    await expect(engines.start(machine, { parts: { http: world.http } })).resolves.toMatchObject({
      state: "ready",
    });
    await world.until((call) => call.method === "getUpdates");
    expect(machine.bot.menus()).toHaveLength(2);
    expect(machine.bot.menus()).toContainEqual(expect.objectContaining({ languageCode: "zh" }));
    machine.bot.push(ownerText(1, `/start ${code}`));
    await world.until(sent("You are now the owner of this bot."));
    await nextSecond();
    machine.bot.push(ownerText(2, "/status"));
    await world.until(sent("binference 2026.10.0-test is running."));
    await nextSecond();
    const frozen = await runOn(machine, ["freeze", "--yes", "--json"]);
    expect(frozen.code).toBe(0);
    await world.until(sent("is frozen from the CLI."));
  });

  it("still answers the owner it paired after the engine restarts", slow, async () => {
    const { machine, clock, code } = await setUp();
    const before = watchedWorld(machine);
    await engines.start(machine, { parts: { http: before.http } });
    machine.bot.push(ownerText(1, `/start ${code}`));
    await before.until(sent("You are now the owner of this bot."));
    // The next poll starts once the pairing message is handled, so the restart has nothing left.
    await clock.advance(1_000);
    await before.until(poll(2));
    await engines.stopAll();
    const after = watchedWorld(machine);
    await expect(engines.start(machine, { parts: { http: after.http } })).resolves.toMatchObject({
      state: "ready",
    });
    machine.bot.push(ownerText(2, "/status"));
    await after.until(sent("binference 2026.10.0-test is running."));
  });

  it(
    "still refuses a Mini App launch that signed in before the engine restarted",
    slow,
    async () => {
      const { machine, clock, code } = await setUp();
      const port = await freePort();
      const origin = `http://127.0.0.1:${String(port)}`;
      const before = watchedWorld(machine);
      await engines.start(machine, { port, parts: { http: before.http } });
      machine.bot.push(ownerText(1, `/start ${code}`));
      await before.until(sent("You are now the owner of this bot."));
      const initData = signedLaunch(ownerId, clock.now());
      const signal = AbortSignal.timeout(10_000);
      await expect(openMini(origin, initData, clock).connect(signal)).resolves.toMatchObject({
        t: "ready",
      });
      minis.splice(0).forEach((client) => client.close());
      await clock.advance(1_000);
      await before.until(poll(2));
      await engines.stopAll();
      await engines.start(machine, { port, parts: { http: watchedWorld(machine).http } });
      const replay = openMini(origin, initData, clock);
      await expect(replay.connect(signal)).rejects.toMatchObject({ code: "auth.invalid" });
      const fresh = signedLaunch(ownerId, clock.now(), "AAHdF6IQAAAAAN0XohDhrOrd");
      await expect(openMini(origin, fresh, clock).connect(signal)).resolves.toMatchObject({
        t: "ready",
      });
    },
  );

  it(
    "opens the Mini App from /console at the public address, and lets its origin in",
    slow,
    async () => {
      const { machine, clock, code } = await setUp();
      const world = watchedWorld(machine);
      const origin = "https://owner.example.ts.net";
      const env = { ...secretEnv(machine), BINFERENCE_REMOTE__PUBLIC_URL: origin };
      const port = await freePort();
      await engines.start(machine, { env, port, parts: { http: world.http } });
      machine.bot.push(ownerText(1, `/start ${code}`));
      await world.until(sent("You are now the owner of this bot."));
      // The bot's throttler spaces the messages to one chat a second apart on the engine's clock.
      await clock.advance(1_000);
      machine.bot.push(ownerText(2, "/console"));
      await world.until(sent("open the console inside Telegram"));
      const buttons = machine.bot
        .messages()
        .slice(-1)
        .flatMap((message) => message.buttons.flat());
      expect(buttons.map((button) => button.text)).toStrictEqual(["Open the console"]);
      expect(buttons[0]?.webApp).toMatch(
        /^https:\/\/owner\.example\.ts\.net\/mini#ticket=[\w-]{43}$/,
      );
      const address = `http://127.0.0.1:${String(port)}`;
      const initData = signedLaunch(ownerId, clock.now());
      const mini = miniAppClient({ origin, address, initData, clock });
      minis.push(mini);
      await expect(mini.connect(AbortSignal.timeout(10_000))).resolves.toMatchObject({
        t: "ready",
      });
    },
  );

  it("pairs another account with binference telegram pair and tells the owner", slow, async () => {
    const { machine, clock, code } = await setUp();
    const world = watchedWorld(machine);
    await engines.start(machine, { parts: { http: world.http } });
    machine.bot.push(ownerText(1, `/start ${code}`));
    await world.until(sent("You are now the owner of this bot."));
    const paired = await runOn(machine, ["telegram", "pair", "--json"]);
    expect([paired.code, paired.stderr]).toStrictEqual([0, ""]);
    const { link, expiresAt } = repairingSchema.parse(JSON.parse(paired.stdout));
    expect(expiresAt).toBe(clock.now() + 10 * 60 * 1000);
    const next = startCodeOf(link);
    expect(next).not.toBe(code);
    await clock.advance(1_000);
    machine.bot.push(textFrom(nextOwnerId, 2, `/start ${next}`));
    await world.until(sentTo(ownerId, "Not you? Freeze now"));
    await world.until(sentTo(nextOwnerId, "You are now the owner of this bot."));
    await clock.advance(1_000);
    machine.bot.push(textFrom(nextOwnerId, 3, "/status"));
    await world.until(sent("binference 2026.10.0-test is running."));
    expect((await engineLogLines(machine)).join("\n")).not.toContain(next);
  });

  it("starts without the bot when its token cannot be read, and says why", slow, async () => {
    const { machine } = await setUp();
    const env = Object.fromEntries(
      Object.entries(secretEnv(machine)).filter(([name]) => name !== secretVariables.botToken),
    );
    await expect(engines.start(machine, { env })).resolves.toMatchObject({ state: "ready" });
    const skipped = (await engineLogLines(machine)).filter((line) =>
      line.includes('"event":"telegram.bot_skipped"'),
    );
    expect(skipped).toHaveLength(1);
    expect(skipped[0]).toContain('"errorCode":"config.secret_unavailable"');
    expect(skipped[0]).not.toContain(fakeBotToken);
  });
});
