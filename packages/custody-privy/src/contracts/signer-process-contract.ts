import assert from "node:assert/strict";
import { createPublicKey, verify } from "node:crypto";
import type { ContractCheck } from "@binference/core/testing";
import type { SignerProcess } from "../ports.js";
import type { AuthorizeRequest } from "../signer-process/authorize-request.js";
import { signaturePayload } from "../signer-process/privy-request.js";

/** A signer under test, and a request its hard rules let through. */
export interface SignerProcessSubject {
  readonly signerProcess: SignerProcess;
  readonly request: AuthorizeRequest;
}

/** Makes a fresh {@link SignerProcessSubject} for each check. */
export interface SignerProcessHarness {
  create(): SignerProcessSubject;
}

const live = (): { readonly signal: AbortSignal } => ({ signal: new AbortController().signal });

function verifies(publicKey: string, request: AuthorizeRequest, signature: string): boolean {
  const key = createPublicKey({
    key: Buffer.from(publicKey, "base64"),
    format: "der",
    type: "spki",
  });
  const payload = Buffer.from(signaturePayload(request.request), "utf8");
  return verify("sha256", payload, key, Buffer.from(signature, "base64"));
}

async function signed(subject: SignerProcessSubject): Promise<string> {
  const answer = await subject.signerProcess.authorize(subject.request, live());
  assert.ok(answer.ok);
  return answer.value.signature;
}

/** The contract every `SignerProcess` adapter passes. */
export function signerProcessContract(harness: SignerProcessHarness): readonly ContractCheck[] {
  return [
    {
      name: "answers the agent key's public half as a P-256 key in DER SubjectPublicKeyInfo",
      run: async () => {
        const { signerProcess } = harness.create();
        const { publicKey } = await signerProcess.publicKey(live());
        const key = createPublicKey({
          key: Buffer.from(publicKey, "base64"),
          format: "der",
          type: "spki",
        });
        assert.equal(key.asymmetricKeyDetails?.namedCurve, "prime256v1");
      },
    },
    {
      name: "signs Privy's payload of the request with the agent key, DER in base64",
      run: async () => {
        const subject = harness.create();
        const { publicKey } = await subject.signerProcess.publicKey(live());
        assert.ok(verifies(publicKey, subject.request, await signed(subject)));
      },
    },
    {
      name: "signs that request only: the signature does not cover another body or URL",
      run: async () => {
        const subject = harness.create();
        const { publicKey } = await subject.signerProcess.publicKey(live());
        const signature = await signed(subject);
        const { request } = subject.request;
        const otherBody = { ...subject.request, request: { ...request, body: { method: "x" } } };
        const otherUrl = { ...subject.request, request: { ...request, url: `${request.url}x` } };
        assert.equal(verifies(publicKey, otherBody, signature), false);
        assert.equal(verifies(publicKey, otherUrl, signature), false);
      },
    },
    {
      name: "answers and signs nothing on an aborted signal",
      run: async () => {
        const { signerProcess, request } = harness.create();
        const reason = new Error("stopped");
        const aborted = { signal: AbortSignal.abort(reason) };
        await assert.rejects(signerProcess.publicKey(aborted), reason);
        await assert.rejects(signerProcess.authorize(request, aborted), reason);
      },
    },
  ];
}
