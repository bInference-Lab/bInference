import { createSecret } from "@binference/core";
import { createManualClock, createSeededRandom, type ManualClock } from "@binference/core/testing";
import { type AccessStore, sha256Hex } from "@binference/engine";
import { issueLaunchTicket, launchTicketHash } from "@binference/engine/access";
import { createMemoryAccessStore } from "@binference/engine/testing";
import { describe, expect, it } from "vitest";
import { createSignIn, type MiniAppAuth } from "./sign-in.js";
import { telegramLaunchHash } from "./telegram-launch.js";

const live = { signal: new AbortController().signal };
const connection = "con_0190f1c2-3a4b-7c5d-8e6f-000000000001";
const call = { signal: live.signal, claim: () => undefined };
const botToken = createSecret("7012345678:AAE_fakeTokenForTestsOnly_0123456789ab");
const ownerId = 279_058_397;
const launchAtMs = 1_760_000_000_000;
const random = createSeededRandom(3);

// A launch's `initData` as Telegram signs it with the test bot token.
function launchOf(launch: {
  readonly userId: number;
  readonly atMs: number;
  readonly query?: string;
}) {
  const fields = new Map([
    ["query_id", launch.query ?? "AAHdF6IQAAAAAN0XohDhrOrc"],
    ["user", JSON.stringify({ id: launch.userId, first_name: "Ada" })],
    ["auth_date", String(launch.atMs / 1_000)],
  ]);
  const hash = telegramLaunchHash(fields, botToken);
  return new URLSearchParams([...fields, ["hash", hash]]).toString();
}

function miniRequest(initData: string, ticket?: string, transport: "ws" | "ipc" = "ws") {
  const telegram = ticket === undefined ? { initData } : { initData, ticket };
  return { credential: { telegram }, transport, origin: "https://x.ts.net", connection } as const;
}

interface MiniSetUp {
  readonly clock: ManualClock;
  readonly auth: { readonly access: AccessStore; readonly miniApp: MiniAppAuth };
  readonly signIn: ReturnType<typeof createSignIn>;
  /** A new launch ticket `/console` made for the owner now. */
  readonly ticket: () => Promise<string>;
}

let seed = 0;

function setUp(owner: number | undefined, access = createMemoryAccessStore()): MiniSetUp {
  const clock = createManualClock(launchAtMs + 30_000);
  const miniApp: MiniAppAuth = { botToken, ownerId: async () => owner };
  const auth = { access, miniApp };
  const ticket = async (): Promise<string> => {
    seed += 1;
    const options = { access, clock, random: createSeededRandom(seed) };
    return issueLaunchTicket(options, { userId: ownerId, ...live });
  };
  return { clock, auth, ticket, signIn: createSignIn({ auth, clock, random }) };
}

const ownerLaunch = launchOf({ userId: ownerId, atMs: launchAtMs });

describe("createSignIn for the Telegram Mini App", () => {
  it("signs the owner's launch in with the Mini App's scopes", async () => {
    const { signIn, ticket } = setUp(ownerId);
    const step = await signIn.start(miniRequest(ownerLaunch, await ticket()), call);
    expect(step).toStrictEqual({
      ok: true,
      value: {
        kind: "signed_in",
        identity: {
          credential: "tg:279058397",
          scopes: ["read", "chat", "confirm", "loosen"],
          expiresAtMs: launchAtMs + 30_000 + 12 * 60 * 60_000,
        },
      },
    });
  });

  it.each([
    ["a launch of another Telegram user", launchOf({ userId: ownerId + 1, atMs: launchAtMs })],
    [
      "a launch someone changed after Telegram signed it",
      launchOf({ userId: ownerId + 1, atMs: launchAtMs }).replace(
        String(ownerId + 1),
        String(ownerId),
      ),
    ],
  ])("refuses %s", async (_name, initData) => {
    const { signIn, ticket } = setUp(ownerId);
    await expect(signIn.start(miniRequest(initData, await ticket()), call)).resolves.toStrictEqual({
      ok: false,
      error: "auth.invalid",
    });
  });

  it("refuses every launch before the owner paired the bot", async () => {
    const { signIn, ticket } = setUp(undefined);
    await expect(
      signIn.start(miniRequest(ownerLaunch, await ticket()), call),
    ).resolves.toStrictEqual({ ok: false, error: "auth.invalid" });
  });

  it("refuses a launch older than 5 minutes as expired", async () => {
    const { signIn, ticket } = setUp(ownerId);
    const old = launchOf({ userId: ownerId, atMs: launchAtMs - 5 * 60_000 });
    await expect(signIn.start(miniRequest(old, await ticket()), call)).resolves.toStrictEqual({
      ok: false,
      error: "auth.expired",
    });
  });

  it("refuses a launch that signed in before, and still takes a new one", async () => {
    const { signIn, clock, ticket } = setUp(ownerId);
    const first = await signIn.start(miniRequest(ownerLaunch, await ticket()), call);
    await clock.advance(1_000);
    const again = await signIn.start(miniRequest(ownerLaunch, await ticket()), call);
    const next = launchOf({
      userId: ownerId,
      atMs: launchAtMs + 1_000,
      query: "AAHdF6IQAAAAAN0XohDhrOrd",
    });
    const fresh = await signIn.start(miniRequest(next, await ticket()), call);
    expect([first.ok, again, fresh.ok]).toStrictEqual([
      true,
      { ok: false, error: "auth.invalid" },
      true,
    ]);
  });

  it("refuses a launch that signed in before the engine restarted on the same store", async () => {
    const { signIn, auth, clock, ticket } = setUp(ownerId);
    const first = await signIn.start(miniRequest(ownerLaunch, await ticket()), call);
    const restarted = createSignIn({ auth, clock, random });
    const again = await restarted.start(miniRequest(ownerLaunch, await ticket()), call);
    expect([first.ok, again]).toStrictEqual([true, { ok: false, error: "auth.invalid" }]);
  });

  it("claims the SHA-256 of the launch's hash with its ticket, at the engine's time", async () => {
    const claims: unknown[] = [];
    const inner = createMemoryAccessStore();
    const access: AccessStore = {
      ...inner,
      claimLaunch: async (claim, options) => {
        claims.push(claim);
        return inner.claimLaunch(claim, options);
      },
    };
    const { signIn, ticket } = setUp(ownerId, access);
    const made = await ticket();
    await signIn.start(miniRequest(ownerLaunch, made), call);
    const hash = String(new URLSearchParams(ownerLaunch).get("hash"));
    const atMs = launchAtMs + 30_000;
    expect(claims).toStrictEqual([
      {
        launchHash: sha256Hex(hash),
        ticketHash: launchTicketHash(made),
        userId: ownerId,
        atMs,
        sinceMs: atMs - 24 * 60 * 60_000 + 1,
      },
    ]);
  });

  it("refuses a launch over IPC, and every launch without the owner's bot", async () => {
    const { signIn, ticket } = setUp(ownerId);
    const clock = createManualClock(launchAtMs);
    const botless = createSignIn({ auth: { access: createMemoryAccessStore() }, clock, random });
    expect([
      await signIn.start(miniRequest(ownerLaunch, await ticket(), "ipc"), call),
      await botless.start(miniRequest(ownerLaunch, await ticket()), call),
    ]).toStrictEqual([
      { ok: false, error: "auth.invalid" },
      { ok: false, error: "auth.invalid" },
    ]);
  });
});

describe("createSignIn for a Mini App launch's ticket", () => {
  it("refuses a launch without a ticket, or with one /console never made", async () => {
    const { signIn } = setUp(ownerId);
    const unknown = "U".repeat(43);
    expect([
      await signIn.start(miniRequest(ownerLaunch), call),
      await signIn.start(miniRequest(ownerLaunch, unknown), call),
    ]).toStrictEqual([
      { ok: false, error: "auth.invalid" },
      { ok: false, error: "auth.invalid" },
    ]);
  });

  it("spends the ticket: a second launch with it is refused", async () => {
    const { signIn, ticket } = setUp(ownerId);
    const made = await ticket();
    const next = launchOf({ userId: ownerId, atMs: launchAtMs, query: "AAHdF6IQAAAAAN0XohDhrOrd" });
    const first = await signIn.start(miniRequest(ownerLaunch, made), call);
    const second = await signIn.start(miniRequest(next, made), call);
    expect([first.ok, second]).toStrictEqual([true, { ok: false, error: "auth.invalid" }]);
  });

  it("refuses a ticket older than 5 minutes as expired", async () => {
    const { signIn, ticket, clock } = setUp(ownerId);
    const made = await ticket();
    await clock.advance(5 * 60_000);
    const fresh = launchOf({ userId: ownerId, atMs: clock.now() });
    await expect(signIn.start(miniRequest(fresh, made), call)).resolves.toStrictEqual({
      ok: false,
      error: "auth.expired",
    });
  });

  it("names the owner, then refuses the launch when a new owner is bound during it", async () => {
    let owner = ownerId;
    const inner = createMemoryAccessStore();
    const access: AccessStore = {
      ...inner,
      claimLaunch: async (claim, options) => {
        owner = ownerId + 1;
        return inner.claimLaunch(claim, options);
      },
    };
    const { auth, clock, ticket } = setUp(ownerId, access);
    const miniApp: MiniAppAuth = { botToken, ownerId: async () => owner };
    const signIn = createSignIn({ auth: { ...auth, miniApp }, clock, random });
    const claimed: string[] = [];
    const watched = { signal: live.signal, claim: (id: string) => claimed.push(id) };
    const step = await signIn.start(miniRequest(ownerLaunch, await ticket()), watched);
    expect([step, claimed]).toStrictEqual([{ ok: false, error: "auth.revoked" }, ["tg:279058397"]]);
  });
});
