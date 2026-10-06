import type { JsonValue } from "@binference/core";
import {
  createManualClock,
  createMemoryLogger,
  createSeededRandom,
} from "@binference/core/testing";
import type { InboxStore } from "@binference/engine";
import { createMemoryAccessStore, createMemoryInboxStore } from "@binference/engine/testing";
import { Api } from "grammy";
import { describe, expect, it } from "vitest";
import { createMemoryOwnerStore } from "../fakes/memory-owner-store.js";
import { createTelegramIngress, type UpdateIntake } from "../ingress/create-telegram-ingress.js";
import type { OwnerUpdate } from "../ingress/decide-update.js";
import { createFakeBotApi, type FakeBotApi, fakeBotToken } from "../testing/fake-bot-api.js";
import { ownerId, textUpdate } from "../testing/update-fixtures.js";
import { chatUpdateSchema } from "../updates/chat-update.schema.js";
import { pollUpdates } from "./poll-updates.js";
import { createApiFetcher } from "./update-fetcher.js";

const live = { signal: new AbortController().signal };
const crash = new Error("the engine stopped");
const stop = new Error("stopped by the test");

interface Engine {
  readonly ingress: ReturnType<typeof createTelegramIngress>;
  readonly delivered: OwnerUpdate[];
}

// One engine life: an ingress over stores that outlive it, as the database does a restart.
function startEngine(botApi: FakeBotApi, stores: { inbox: InboxStore }): Engine {
  const delivered: OwnerUpdate[] = [];
  const ingress = createTelegramIngress({
    api: new Api(fakeBotToken, { fetch: botApi.fetch }),
    stores: { ...sharedStores, ...stores },
    clock: createManualClock(1),
    logger: createMemoryLogger({ subsystem: "telegram" }),
    display: { timeZone: "UTC" },
    onOwnerUpdate: async (update) => {
      delivered.push(update);
      await Promise.resolve();
    },
  });
  return { ingress, delivered };
}

const sharedStores = { access: createMemoryAccessStore(), owners: createMemoryOwnerStore() };
await sharedStores.owners.bind({ userId: ownerId, pairedAtMs: 1 }, live);

function poll(botApi: FakeBotApi, intake: UpdateIntake, signal: AbortSignal) {
  const clock = createManualClock(1);
  const fetcher = createApiFetcher(new Api(fakeBotToken, { fetch: botApi.fetch }));
  const run = pollUpdates({ fetcher, intake, clock, random: createSeededRandom(3), signal });
  return { run, clock };
}

// Wraps the inbox so the engine stops the moment the update is stored.
function crashAfterStoring(inbox: InboxStore, controller: AbortController): InboxStore {
  return {
    ...inbox,
    admit: async (draft, options) => {
      const admitted = await inbox.admit(draft, options);
      controller.abort(crash);
      return admitted;
    },
  };
}

async function restartAndDrain(botApi: FakeBotApi, inbox: InboxStore): Promise<Engine> {
  const engine = startEngine(botApi, { inbox });
  await engine.ingress.resume(live);
  const controller = new AbortController();
  const { run } = poll(botApi, engine.ingress, controller.signal);
  await botApi.idle();
  controller.abort(stop);
  await expect(run).rejects.toBe(stop);
  return engine;
}

type InboxWrap = (inbox: InboxStore, controller: AbortController) => InboxStore;

const asItIs: InboxWrap = (inbox) => inbox;

// Runs one engine life over an update Telegram holds, until the engine stops: right after the
// update is stored (the inbox wrap stops it), or right after it is handled (the intake does).
async function runUntilStopped(wrap: InboxWrap) {
  const botApi = createFakeBotApi();
  const inbox = createMemoryInboxStore();
  botApi.push(textUpdate({ updateId: 41, from: ownerId, text: "buy 0.1 BNB of CAKE" }));
  const controller = new AbortController();
  const first = startEngine(botApi, { inbox: wrap(inbox, controller) });
  const intake: UpdateIntake = {
    receive: async (update, options) => {
      await first.ingress.receive(update, options);
      controller.abort(crash);
    },
  };
  const { run } = poll(botApi, intake, controller.signal);
  await expect(run).rejects.toBe(crash);
  expect(botApi.pending()).toStrictEqual([41]);
  return { botApi, inbox, first };
}

describe("pollUpdates", () => {
  it("processes an update once when the engine stops after storing it and before handling it", async () => {
    const { botApi, inbox, first } = await runUntilStopped(crashAfterStoring);
    expect(first.delivered).toStrictEqual([]);
    const second = await restartAndDrain(botApi, inbox);
    expect(second.delivered.map((update) => update.updateId)).toStrictEqual([41]);
    expect(botApi.pending()).toStrictEqual([]);
    expect(await inbox.unhandled(10, live)).toStrictEqual([]);
  });

  it("processes an update once when the engine stops after handling it and before acknowledging it", async () => {
    const { botApi, inbox, first } = await runUntilStopped(asItIs);
    expect(first.delivered.map((update) => update.updateId)).toStrictEqual([41]);
    const second = await restartAndDrain(botApi, inbox);
    expect(second.delivered).toStrictEqual([]);
    expect(botApi.pending()).toStrictEqual([]);
    expect(await inbox.unhandled(10, live)).toStrictEqual([]);
  });

  it("acknowledges a batch only with the next call, after every update in it is stored", async () => {
    const botApi = createFakeBotApi();
    const stored: number[] = [];
    const intake: UpdateIntake = {
      receive: async (update) => {
        stored.push(chatUpdateSchema.parse(update).updateId);
        expect(botApi.pending()).toContain(stored.at(-1));
        await Promise.resolve();
      },
    };
    botApi.push(...[1, 2, 3].map((n) => textUpdate({ updateId: n, from: ownerId, text: "x" })));
    const controller = new AbortController();
    const { run } = poll(botApi, intake, controller.signal);
    await botApi.idle();
    expect(stored).toStrictEqual([1, 2, 3]);
    expect(botApi.pending()).toStrictEqual([]);
    botApi.push(textUpdate({ updateId: 4, from: ownerId, text: "y" }));
    await botApi.idle();
    controller.abort(stop);
    await expect(run).rejects.toBe(stop);
    expect(stored).toStrictEqual([1, 2, 3, 4]);
  });

  it("leaves an update Telegram holds when the intake cannot store it", async () => {
    const botApi = createFakeBotApi();
    botApi.push(textUpdate({ updateId: 5, from: ownerId, text: "x" }));
    const full = new Error("disk full");
    const intake: UpdateIntake = { receive: async () => Promise.reject(full) };
    const { run } = poll(botApi, intake, new AbortController().signal);
    await expect(run).rejects.toBe(full);
    expect(botApi.pending()).toStrictEqual([5]);
  });

  it("waits as long as Telegram asks after a flood, and backs off while the network is down", async () => {
    const botApi = createFakeBotApi();
    const received: JsonValue[] = [];
    const intake: UpdateIntake = {
      receive: async (update) => {
        received.push(update);
        await Promise.resolve();
      },
    };
    botApi.failNext("getUpdates", {
      status: 429,
      description: "Too Many Requests",
      retryAfterS: 3,
    });
    botApi.push(textUpdate({ updateId: 6, from: ownerId, text: "x" }));
    const controller = new AbortController();
    const { run, clock } = poll(botApi, intake, controller.signal);
    await clock.advance(2_999);
    expect(received).toStrictEqual([]);
    await clock.advance(1 + 1_000);
    await botApi.idle();
    expect(received).toHaveLength(1);
    botApi.failNext("getUpdates", "network");
    botApi.push(textUpdate({ updateId: 7, from: ownerId, text: "y" }));
    await clock.advance(1_000);
    await botApi.idle();
    expect(received).toHaveLength(2);
    controller.abort(stop);
    await expect(run).rejects.toBe(stop);
  });

  it.each([
    ["a refused token", { status: 401, description: "Unauthorized" }, "telegram.bad_token"],
    ["another poller", { status: 409, description: "Conflict" }, "telegram.poll_conflict"],
  ] as const)("stops for %s", async (_cause, refusal, code) => {
    const botApi = createFakeBotApi();
    botApi.failNext("getUpdates", refusal);
    const intake: UpdateIntake = { receive: async () => Promise.resolve() };
    const { run } = poll(botApi, intake, new AbortController().signal);
    await expect(run).rejects.toMatchObject({ code, retryable: false });
  });
});
