import { createPublicKey, verify } from "node:crypto";
import type { Id, Result } from "@binference/core";
import { describe, expect, it } from "vitest";
import { signerProcessContract } from "../contracts/signer-process-contract.js";
import type {
  AuthorizationSignature,
  AuthorizeRequest,
} from "../signer-process/authorize-request.js";
import { signaturePayload } from "../signer-process/privy-request.js";
import { createFakeSignerProcess } from "./fake-signer-process.js";

const uuid = "0190f1c2-3b4c-7d5e-8f60-718293a4b5c6";
const request: AuthorizeRequest = {
  wallet: `wal_${uuid}` as Id<"wal">,
  request: {
    method: "POST",
    url: "https://api.privy.io/v1/wallets/abc/rpc",
    body: { method: "eth_signTransaction", params: { transaction: { chain_id: 56 } } },
    headers: { "privy-app-id": "app", "privy-request-expiry": "1790000300000" },
  },
  intent: `int_${uuid}` as Id<"int">,
  step: 0,
  authorization: { confirmation: `cnf_${uuid}` as Id<"cnf"> },
  termsHash: "0".repeat(64),
  allowed: [],
};
const live = { signal: new AbortController().signal };

function signatureOf(answer: Result<AuthorizationSignature, "refused">): Buffer {
  if (!answer.ok) {
    throw new Error("The fake refused.");
  }
  return Buffer.from(answer.value.signature, "base64");
}

describe("fake signer process", () => {
  it.each(
    signerProcessContract({
      create: () => ({ signerProcess: createFakeSignerProcess(), request }),
    }),
  )("follows the contract: $name", async ({ run }) => {
    await expect(run()).resolves.toBeUndefined();
  });

  it("records each request and refuses all once told to, as a failed hard rule does", async () => {
    const signer = createFakeSignerProcess();
    await expect(signer.authorize(request, live)).resolves.toMatchObject({ ok: true });
    signer.refuseFromNow();
    await expect(signer.authorize(request, live)).resolves.toStrictEqual({
      ok: false,
      error: "refused",
    });
    expect(signer.requests()).toStrictEqual([request, request]);
  });

  it("holds a key of its own: two fakes never sign for each other", async () => {
    const [one, two] = [createFakeSignerProcess(), createFakeSignerProcess()];
    const signature = signatureOf(await one.authorize(request, live));
    const { publicKey } = await two.publicKey(live);
    const key = createPublicKey({
      key: Buffer.from(publicKey, "base64"),
      format: "der",
      type: "spki",
    });
    const payload = Buffer.from(signaturePayload(request.request));
    expect(verify("sha256", payload, key, signature)).toBe(false);
  });
});
