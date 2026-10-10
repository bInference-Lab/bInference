import type { Http } from "@binference/core";
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
import { engineLogLines } from "./test-host.js";
import { createRunningEngines } from "./unlock-fixtures.js";

const slow = { timeout: 60_000 };
const engines = createRunningEngines();
const folders: TempFolder[] = [];
// The owner's numeric Telegram id, who opens the pairing link.
const ownerId = 7_012_345_678;
const telegramOrigin = "https://api.telegram.org";
const pairingSchema = z.object({ pairing: z.object({ link: z.url() }) });

afterEach(async () => {
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

// A text the owner types in the bot's private chat, as Telegram delivers it.
function ownerText(updateId: number, text: string) {
  const chat = { id: ownerId, type: "private" };
  const from = { id: ownerId, is_bot: false, first_name: "Owner" };
  return { update_id: updateId, message: { message_id: updateId, date: 1, chat, from, text } };
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
  return { machine, clock, code: new URL(link).searchParams.get("start") ?? "" };
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
