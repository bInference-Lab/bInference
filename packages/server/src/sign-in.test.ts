import { createSecret, idSchema } from "@binference/core";
import { createManualClock, createSeededRandom } from "@binference/core/testing";
import { type AccessStore, sha256Hex } from "@binference/engine";
import { createMemoryAccessStore } from "@binference/engine/testing";
import { describe, expect, it } from "vitest";
import { createSignIn, type MiniAppAuth } from "./sign-in.js";
import { telegramLaunchHash } from "./telegram-launch.js";

const token = `bnt_${"t".repeat(43)}`;
const tokenId = idSchema("tok").parse("tok_0190f1c2-3a4b-7c5d-8e6f-000000000001");
const deviceId = idSchema("dev").parse("dev_0190f1c2-3a4b-7c5d-8e6f-000000000001");
const live = { signal: new AbortController().signal };

async function accessWithToken(
  expiry: { readonly expiresAtMs?: number } = {},
): Promise<AccessStore> {
  const access = createMemoryAccessStore();
  await access.addToken(
    {
      id: tokenId,
      label: "mcp",
      kind: "mcp",
      scopes: ["read", "propose"],
      secretHash: sha256Hex(token),
      createdAtMs: 0,
      ...expiry,
    },
    live,
  );
  return access;
}

describe("createSignIn", () => {
  const clock = createManualClock(500);
  const random = createSeededRandom(3);

  it("signs a token in over IPC with its scopes and marks its use", async () => {
    const access = await accessWithToken();
    const signIn = createSignIn({ auth: { access }, clock, random });
    const step = await signIn.start({ credential: { token }, transport: "ipc" }, live.signal);
    expect(step).toStrictEqual({
      ok: true,
      value: { kind: "signed_in", identity: { credential: tokenId, scopes: ["read", "propose"] } },
    });
    const [stored] = await access.listTokens(live);
    expect(stored?.lastUsedAtMs).toBe(500);
  });

  it.each([
    [
      "a token over WS",
      { credential: { token }, transport: "ws", origin: "http://x" },
      "auth.local_only",
    ],
    ["a device over IPC", { credential: { device: deviceId }, transport: "ipc" }, "auth.invalid"],
    [
      "a device without an origin",
      { credential: { device: deviceId }, transport: "ws" },
      "auth.invalid",
    ],
    [
      "an unknown device",
      { credential: { device: deviceId }, transport: "ws", origin: "http://x" },
      "auth.invalid",
    ],
  ] as const)("refuses %s", async (_name, request, code) => {
    const signIn = createSignIn({
      auth: { access: await accessWithToken() },
      clock,
      random,
    });
    await expect(signIn.start(request, live.signal)).resolves.toStrictEqual({
      ok: false,
      error: code,
    });
  });

  it("signs a token in before its expiry, carrying it, and refuses it from then on", async () => {
    const before = createSignIn({
      auth: { access: await accessWithToken({ expiresAtMs: 501 }) },
      clock,
      random,
    });
    const request = { credential: { token }, transport: "ipc" } as const;
    await expect(before.start(request, live.signal)).resolves.toMatchObject({
      ok: true,
      value: { identity: { credential: tokenId, expiresAtMs: 501 } },
    });
    const access = await accessWithToken({ expiresAtMs: 500 });
    const at = createSignIn({ auth: { access }, clock, random });
    await expect(at.start(request, live.signal)).resolves.toStrictEqual({
      ok: false,
      error: "auth.expired",
    });
    const [stored] = await access.listTokens(live);
    expect(stored?.lastUsedAtMs).toBeUndefined();
  });

  it("refuses every sign-in when the server holds no credentials", async () => {
    const signIn = createSignIn({ clock, random });
    const step = await signIn.start({ credential: { token }, transport: "ipc" }, live.signal);
    expect(step).toStrictEqual({ ok: false, error: "auth.required" });
  });

  it("refuses a revoked device before it is challenged", async () => {
    const access = createMemoryAccessStore();
    await access.addDevice(
      { id: deviceId, label: "browser", alg: "ed25519", publicKey: "AAAA", createdAtMs: 0 },
      live,
    );
    await access.revokeDevice({ id: deviceId, atMs: 1 }, live);
    const signIn = createSignIn({ auth: { access }, clock, random });
    const request = {
      credential: { device: deviceId },
      transport: "ws",
      origin: "http://x",
    } as const;
    await expect(signIn.start(request, live.signal)).resolves.toStrictEqual({
      ok: false,
      error: "auth.revoked",
    });
  });
});

const botToken = createSecret("7012345678:AAE_fakeTokenForTestsOnly_0123456789ab");
const ownerId = 279_058_397;
const launchAtMs = 1_760_000_000_000;

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

function miniRequest(initData: string, transport: "ws" | "ipc" = "ws") {
  return { credential: { telegram: { initData } }, transport, origin: "https://x.ts.net" } as const;
}

describe("createSignIn for the Telegram Mini App", () => {
  const random = createSeededRandom(3);

  function setUp(owner: number | undefined) {
    const clock = createManualClock(launchAtMs + 30_000);
    const miniApp: MiniAppAuth = { botToken, ownerId: async () => owner };
    const auth = { access: createMemoryAccessStore(), miniApp };
    return { clock, auth, signIn: createSignIn({ auth, clock, random }) };
  }

  it("signs the owner's launch in with the Mini App's scopes", async () => {
    const { signIn } = setUp(ownerId);
    const step = await signIn.start(
      miniRequest(launchOf({ userId: ownerId, atMs: launchAtMs })),
      live.signal,
    );
    expect(step).toStrictEqual({
      ok: true,
      value: {
        kind: "signed_in",
        identity: { credential: "tg:279058397", scopes: ["read", "chat", "confirm", "loosen"] },
      },
    });
  });

  it("refuses a launch of another Telegram user", async () => {
    const { signIn } = setUp(ownerId);
    const request = miniRequest(launchOf({ userId: ownerId + 1, atMs: launchAtMs }));
    await expect(signIn.start(request, live.signal)).resolves.toStrictEqual({
      ok: false,
      error: "auth.invalid",
    });
  });

  it("refuses every launch before the owner paired the bot", async () => {
    const { signIn } = setUp(undefined);
    const request = miniRequest(launchOf({ userId: ownerId, atMs: launchAtMs }));
    await expect(signIn.start(request, live.signal)).resolves.toStrictEqual({
      ok: false,
      error: "auth.invalid",
    });
  });

  it("refuses a launch older than 5 minutes as expired", async () => {
    const { signIn } = setUp(ownerId);
    const request = miniRequest(launchOf({ userId: ownerId, atMs: launchAtMs - 5 * 60_000 }));
    await expect(signIn.start(request, live.signal)).resolves.toStrictEqual({
      ok: false,
      error: "auth.expired",
    });
  });

  it("refuses a launch that signed in before, and still takes a new one", async () => {
    const { signIn, clock } = setUp(ownerId);
    const initData = launchOf({ userId: ownerId, atMs: launchAtMs });
    const first = await signIn.start(miniRequest(initData), live.signal);
    await clock.advance(1_000);
    const again = await signIn.start(miniRequest(initData), live.signal);
    const next = launchOf({
      userId: ownerId,
      atMs: launchAtMs + 1_000,
      query: "AAHdF6IQAAAAAN0XohDhrOrd",
    });
    const fresh = await signIn.start(miniRequest(next), live.signal);
    expect([first.ok, again, fresh.ok]).toStrictEqual([
      true,
      { ok: false, error: "auth.invalid" },
      true,
    ]);
  });

  it("refuses a launch that signed in before the engine restarted on the same store", async () => {
    const { signIn, auth, clock } = setUp(ownerId);
    const initData = launchOf({ userId: ownerId, atMs: launchAtMs });
    const first = await signIn.start(miniRequest(initData), live.signal);
    const restarted = createSignIn({ auth, clock, random });
    const again = await restarted.start(miniRequest(initData), live.signal);
    expect([first.ok, again]).toStrictEqual([true, { ok: false, error: "auth.invalid" }]);
  });

  it("claims the SHA-256 of the launch's hash, at the engine's time, for 24 hours", async () => {
    const { auth, clock } = setUp(ownerId);
    const claims: unknown[] = [];
    const access = {
      ...auth.access,
      claimLaunch: async (...args: Parameters<AccessStore["claimLaunch"]>) => {
        claims.push(args[0]);
        return auth.access.claimLaunch(...args);
      },
    };
    const signIn = createSignIn({ auth: { ...auth, access }, clock, random });
    const initData = launchOf({ userId: ownerId, atMs: launchAtMs });
    await signIn.start(miniRequest(initData), live.signal);
    const hash = String(new URLSearchParams(initData).get("hash"));
    const atMs = launchAtMs + 30_000;
    expect(claims).toStrictEqual([
      { launchHash: sha256Hex(hash), atMs, sinceMs: atMs - 24 * 60 * 60_000 + 1 },
    ]);
  });

  it("refuses a launch someone changed after Telegram signed it", async () => {
    const { signIn } = setUp(ownerId);
    const initData = launchOf({ userId: ownerId + 1, atMs: launchAtMs }).replace(
      String(ownerId + 1),
      String(ownerId),
    );
    await expect(signIn.start(miniRequest(initData), live.signal)).resolves.toStrictEqual({
      ok: false,
      error: "auth.invalid",
    });
  });

  it("refuses a launch over IPC, and every launch without the owner's bot", async () => {
    const { signIn } = setUp(ownerId);
    const initData = launchOf({ userId: ownerId, atMs: launchAtMs });
    const clock = createManualClock(launchAtMs);
    const auth = { access: createMemoryAccessStore() };
    const botless = createSignIn({ auth, clock, random });
    expect([
      await signIn.start(miniRequest(initData, "ipc"), live.signal),
      await botless.start(miniRequest(initData), live.signal),
    ]).toStrictEqual([
      { ok: false, error: "auth.invalid" },
      { ok: false, error: "auth.invalid" },
    ]);
  });
});
