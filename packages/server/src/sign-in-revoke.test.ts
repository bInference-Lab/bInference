import { Buffer } from "node:buffer";
import { generateKeyPairSync, sign } from "node:crypto";
import { idSchema } from "@binference/core";
import { createManualClock, createSeededRandom } from "@binference/core/testing";
import { type AccessStore, sha256Hex } from "@binference/engine";
import { createMemoryAccessStore } from "@binference/engine/testing";
import { deviceProofText } from "@binference/protocol";
import { describe, expect, it } from "vitest";
import { type Challenge, createSignIn, type SignIn } from "./sign-in.js";

const token = `bnt_${"t".repeat(43)}`;
const tokenId = idSchema("tok").parse("tok_0190f1c2-3a4b-7c5d-8e6f-000000000001");
const deviceId = idSchema("dev").parse("dev_0190f1c2-3a4b-7c5d-8e6f-000000000001");
const origin = "http://127.0.0.1:7456";
const live = { signal: new AbortController().signal };

function challengeOf(step: Awaited<ReturnType<SignIn["start"]>>): Challenge {
  if (!step.ok || step.value.kind !== "challenge") {
    throw new Error("Expected a challenge.");
  }
  return step.value.challenge;
}

function heard(): { readonly claimed: string[]; readonly claim: (id: string) => void } {
  const claimed: string[] = [];
  return { claimed, claim: (id) => claimed.push(id) };
}

describe("createSignIn when a revoke lands during the sign-in", () => {
  const clock = createManualClock(500);
  const random = createSeededRandom(3);

  it("names the token, then refuses it when the revoke is stored before its use", async () => {
    const inner = createMemoryAccessStore();
    const secretHash = sha256Hex(token);
    const record = {
      id: tokenId,
      label: "mcp",
      kind: "mcp",
      scopes: ["read"],
      secretHash,
    } as const;
    await inner.addToken({ ...record, createdAtMs: 0 }, live);
    const access: AccessStore = {
      ...inner,
      markTokenUsed: async (use, options) => {
        await inner.revokeToken({ id: use.id, atMs: 499 }, options);
        return inner.markTokenUsed(use, options);
      },
    };
    const { claimed, claim } = heard();
    const signIn = createSignIn({ auth: { access }, clock, random });
    const step = await signIn.start(
      { credential: { token }, transport: "ipc" },
      { signal: live.signal, claim },
    );
    expect([step, claimed]).toStrictEqual([{ ok: false, error: "auth.revoked" }, [tokenId]]);
  });

  it("names the device, then refuses its proof when the revoke is stored before it", async () => {
    const inner = createMemoryAccessStore();
    const { publicKey, privateKey } = generateKeyPairSync("ed25519");
    const spki = publicKey.export({ format: "der", type: "spki" }).toString("base64url");
    const device = { id: deviceId, label: "browser", alg: "ed25519", publicKey: spki } as const;
    await inner.addDevice({ ...device, createdAtMs: 0 }, live);
    const access: AccessStore = {
      ...inner,
      markDeviceSeen: async (seen, options) => {
        await inner.revokeDevice({ id: seen.id, atMs: 499 }, options);
        return inner.markDeviceSeen(seen, options);
      },
    };
    const { claimed, claim } = heard();
    const signIn = createSignIn({ auth: { access }, clock, random });
    const request = { credential: { device: deviceId }, transport: "ws", origin } as const;
    const challenge = challengeOf(await signIn.start(request, { signal: live.signal, claim }));
    const text = Buffer.from(deviceProofText({ nonce: challenge.nonce, origin }));
    const signature = sign(null, text, privateKey).toString("base64url");
    const proved = await challenge.prove(signature, live.signal);
    expect([proved, claimed]).toStrictEqual([{ ok: false, error: "auth.revoked" }, [deviceId]]);
  });
});
