import { idSchema } from "@binference/core";
import { createManualClock, createSeededRandom } from "@binference/core/testing";
import { type AccessStore, sha256Hex } from "@binference/engine";
import { createMemoryAccessStore } from "@binference/engine/testing";
import { describe, expect, it } from "vitest";
import { createSignIn } from "./sign-in.js";

const token = `bnt_${"t".repeat(43)}`;
const tokenId = idSchema("tok").parse("tok_0190f1c2-3a4b-7c5d-8e6f-000000000001");
const deviceId = idSchema("dev").parse("dev_0190f1c2-3a4b-7c5d-8e6f-000000000001");
const live = { signal: new AbortController().signal };
const connection = "con_0190f1c2-3a4b-7c5d-8e6f-000000000001";
const call = { signal: live.signal, claim: () => undefined };

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
    const step = await signIn.start({ credential: { token }, transport: "ipc", connection }, call);
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
      { credential: { token }, transport: "ws", connection, origin: "http://x" },
      "auth.local_only",
    ],
    [
      "a device over IPC",
      { credential: { device: deviceId }, transport: "ipc", connection },
      "auth.invalid",
    ],
    [
      "a device without an origin",
      { credential: { device: deviceId }, transport: "ws", connection },
      "auth.invalid",
    ],
    [
      "an unknown device",
      { credential: { device: deviceId }, transport: "ws", connection, origin: "http://x" },
      "auth.invalid",
    ],
  ] as const)("refuses %s", async (_name, request, code) => {
    const signIn = createSignIn({
      auth: { access: await accessWithToken() },
      clock,
      random,
    });
    await expect(signIn.start(request, call)).resolves.toStrictEqual({
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
    const request = { credential: { token }, transport: "ipc", connection } as const;
    await expect(before.start(request, call)).resolves.toMatchObject({
      ok: true,
      value: { identity: { credential: tokenId, expiresAtMs: 501 } },
    });
    const access = await accessWithToken({ expiresAtMs: 500 });
    const at = createSignIn({ auth: { access }, clock, random });
    await expect(at.start(request, call)).resolves.toStrictEqual({
      ok: false,
      error: "auth.expired",
    });
    const [stored] = await access.listTokens(live);
    expect(stored?.lastUsedAtMs).toBeUndefined();
  });

  it("signs an MCP token in with read and propose only, whatever its row holds", async () => {
    const access = createMemoryAccessStore();
    const record = {
      id: tokenId,
      label: "mcp",
      kind: "mcp",
      secretHash: sha256Hex(token),
    } as const;
    await access.addToken(
      { ...record, scopes: ["read", "propose", "confirm"], createdAtMs: 0 },
      live,
    );
    const signIn = createSignIn({ auth: { access }, clock, random });
    const step = await signIn.start({ credential: { token }, transport: "ipc", connection }, call);
    expect(step).toMatchObject({ ok: true, value: { identity: { scopes: ["read", "propose"] } } });
  });

  it("refuses every sign-in when the server holds no credentials", async () => {
    const signIn = createSignIn({ clock, random });
    const step = await signIn.start({ credential: { token }, transport: "ipc", connection }, call);
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
      connection,
      origin: "http://x",
    } as const;
    await expect(signIn.start(request, call)).resolves.toStrictEqual({
      ok: false,
      error: "auth.revoked",
    });
  });
});
