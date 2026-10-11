import type { ProtocolClient } from "@binference/client";
import { type ReadyFrame, readyFrameSchema } from "@binference/protocol";
import { describe, expect, it } from "vitest";
import type { Fetcher } from "../app/console-browser";
import type { ConsoleCredential } from "../connection/console-client";
import type { DeviceStore, StoredDevice } from "../device/device-store";
import { openSession, type SessionContext } from "./open-session";
import type { SessionState } from "./session-state";

const ready: ReadyFrame = readyFrameSchema.parse({
  t: "ready",
  v: 1,
  connection: "con_0190f1c2-3a4b-7c5d-8e6f-000000000001",
  scopes: ["read", "propose", "chat", "confirm", "loosen", "admin"],
  engine: { version: "2026.10.0", protocol: 1, state: "ready" },
  owner: { locale: "en", timezone: "UTC" },
});

function memoryStore(first?: StoredDevice) {
  let kept = first;
  const store: DeviceStore = {
    load: async () => kept,
    save: async (device) => {
      kept = device;
    },
    forget: async () => {
      kept = undefined;
    },
  };
  return { store, kept: () => kept };
}

interface Setup {
  readonly hash?: string;
  readonly pathname?: string;
  readonly stored?: StoredDevice;
  readonly pairAnswer?: { readonly status: number; readonly body: object };
  /** The code a failed connect carries; the connect succeeds when left out. */
  readonly connectError?: string;
  readonly hasCrypto?: boolean;
}

function setUp(setup: Setup) {
  let hash = setup.hash ?? "";
  const memory = memoryStore(setup.stored);
  const credentials: ConsoleCredential[] = [];
  const steps: SessionState["kind"][] = [];
  const answer = setup.pairAnswer ?? { status: 201, body: { deviceId: "dev_new" } };
  const fetcher: Fetcher = async () =>
    new Response(JSON.stringify(answer.body), { status: answer.status });
  const connect = (credential: ConsoleCredential): ProtocolClient => {
    credentials.push(credential);
    const failure = Object.assign(new Error("refused"), { code: setup.connectError });
    return {
      connect: async () => (setup.connectError === undefined ? ready : Promise.reject(failure)),
      close: () => undefined,
    } as unknown as ProtocolClient;
  };
  const context: SessionContext = {
    browser: {
      readHash: () => hash,
      clearHash: () => {
        hash = "";
      },
      subtle: setup.hasCrypto === false ? undefined : globalThis.crypto.subtle,
      fetch: fetcher,
      pathname: setup.pathname ?? "/",
    },
    store: memory.store,
    label: "Browser on test",
    connect,
    report: (state) => steps.push(state.kind),
    signal: new AbortController().signal,
  };
  return { context, memory, credentials, steps, hash: () => hash };
}

const stored = { deviceId: "dev_old", alg: "ed25519", privateKey: {} } as StoredDevice;

describe("opening the console's session", () => {
  it("pairs with the link's code, keeps the device, clears the link and signs in", async () => {
    const test = setUp({ hash: "#pair=q3Zr_x9-AbCdEfGhIjKlMn" });
    const state = await openSession(test.context);
    expect(state).toMatchObject({ kind: "ready", ready });
    expect(test.steps).toStrictEqual(["starting", "pairing", "connecting"]);
    expect(test.hash()).toBe("");
    expect(test.memory.kept()).toMatchObject({ deviceId: "dev_new", alg: "ed25519" });
    expect(test.credentials).toMatchObject([{ kind: "device", device: { deviceId: "dev_new" } }]);
  });

  it.each([
    ["used", { error: { code: "auth.invalid" } }],
    ["expired", { error: { code: "auth.expired" } }],
  ] as const)("stops at a link the engine refused as %s", async (reason, body) => {
    const test = setUp({ hash: "#pair=abc", stored, pairAnswer: { status: 401, body } });
    await expect(openSession(test.context)).resolves.toStrictEqual({ kind: "signed_out", reason });
    expect(test.memory.kept()).toBe(stored);
    expect(test.hash()).toBe("");
  });

  it("signs in with the device this browser keeps", async () => {
    const test = setUp({ stored });
    await expect(openSession(test.context)).resolves.toMatchObject({ kind: "ready" });
    expect(test.credentials).toStrictEqual([{ kind: "device", device: stored }]);
  });

  it("asks for a link when the browser keeps no device", async () => {
    const test = setUp({});
    await expect(openSession(test.context)).resolves.toStrictEqual({
      kind: "signed_out",
      reason: "no_device",
    });
  });

  it("forgets a device the engine revoked", async () => {
    const test = setUp({ stored, connectError: "auth.revoked" });
    await expect(openSession(test.context)).resolves.toStrictEqual({
      kind: "signed_out",
      reason: "revoked",
    });
    expect(test.memory.kept()).toBeUndefined();
  });

  it("keeps the device when the engine does not answer", async () => {
    const test = setUp({ stored, connectError: "client.disconnected" });
    await expect(openSession(test.context)).resolves.toStrictEqual({
      kind: "signed_out",
      reason: "unreachable",
    });
    expect(test.memory.kept()).toBe(stored);
  });

  it("signs a Mini App launch in with its Telegram data", async () => {
    const test = setUp({ pathname: "/mini", hash: "#tgWebAppData=query%3D1&tgWebAppVersion=8" });
    await openSession(test.context);
    expect(test.credentials).toStrictEqual([{ kind: "telegram", initData: "query=1" }]);
  });

  it("says a Mini App launch the engine refused could not sign in", async () => {
    const test = setUp({
      pathname: "/mini",
      hash: "#tgWebAppData=a",
      connectError: "auth.invalid",
    });
    await expect(openSession(test.context)).resolves.toStrictEqual({
      kind: "signed_out",
      reason: "mini_failed",
    });
  });

  it("needs WebCrypto to keep a device key", async () => {
    const test = setUp({ hash: "#pair=abc", hasCrypto: false });
    await expect(openSession(test.context)).resolves.toStrictEqual({
      kind: "signed_out",
      reason: "no_crypto",
    });
  });
});
