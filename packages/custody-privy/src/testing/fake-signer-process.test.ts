import { createPublicKey, verify } from "node:crypto";
import {
  type AuthorizeInput,
  accountRefSchema,
  authorizationPayload,
  type SignerRefusal,
} from "@binference/chain";
import { signerProcessContract } from "@binference/chain/testing";
import type { Id, Result } from "@binference/core";
import { describe, expect, it } from "vitest";
import { testAddresses, testChain } from "./custody-fixtures.js";
import { createFakeSignerProcess } from "./fake-signer-process.js";

const uuid = "0190f1c2-3b4c-7d5e-8f60-718293a4b5c6";
const intent = `int_${uuid}` as Id<"int">;
const termsHash = "0".repeat(64);
const router = accountRefSchema.parse(`${testChain.ref}:${testAddresses.router}`);
const input: AuthorizeInput = {
  wallet: {
    id: `wal_${uuid}` as Id<"wal">,
    custodyId: "abc",
    account: accountRefSchema.parse(`${testChain.ref}:0x8894e0a0c962cb723c1976a4421c95949be2d4e3`),
  },
  request: {
    method: "POST",
    url: "https://api.privy.io/v1/wallets/abc/rpc",
    body: { method: "eth_signTransaction", params: { transaction: { chain_id: 56, nonce: 0 } } },
    headers: { "privy-app-id": "app", "privy-request-expiry": "1790000300000" },
  },
  intent,
  step: { index: 0, chain: testChain.ref, action: { kind: "call", nativeValue: 0n } },
  authorization: {
    kind: "confirmation",
    id: `cnf_${uuid}` as Id<"cnf">,
    intent,
    termsHash,
    expiresAtMs: 1_790_000_060_000,
  },
  termsHash,
  allowed: { contracts: [router], spenders: [], recipients: [] },
};
const live = { signal: new AbortController().signal };

function signatureOf(answer: Result<string, SignerRefusal>): Buffer {
  if (!answer.ok) {
    throw new Error("The fake refused.");
  }
  return Buffer.from(answer.value, "base64");
}

describe("fake signer process", () => {
  it.each(
    signerProcessContract({
      create: async () => Promise.resolve({ signerProcess: createFakeSignerProcess(), input }),
    }),
  )("follows the contract: $name", async ({ run }) => {
    await expect(run()).resolves.toBeUndefined();
  });

  it("records each request and refuses all once told to, as a failed hard rule does", async () => {
    const signer = createFakeSignerProcess();
    await expect(signer.authorize(input, live)).resolves.toMatchObject({ ok: true });
    signer.refuseFromNow("rule_2");
    await expect(signer.authorize(input, live)).resolves.toStrictEqual({
      ok: false,
      error: "rule_2",
    });
    expect(signer.requests()).toStrictEqual([input, input]);
  });

  it("holds a key of its own: two fakes never sign for each other", async () => {
    const [one, two] = [createFakeSignerProcess(), createFakeSignerProcess()];
    const signature = signatureOf(await one.authorize(input, live));
    const key = createPublicKey({
      key: Buffer.from(await two.publicKey(live), "base64"),
      format: "der",
      type: "spki",
    });

    expect(verify("sha256", authorizationPayload(input.request), key, signature)).toBe(false);
  });
});
