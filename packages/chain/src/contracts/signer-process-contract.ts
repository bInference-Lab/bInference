import assert from "node:assert/strict";
import { createPublicKey, verify } from "node:crypto";
import type { ContractCheck } from "@binference/core/testing";
import { authorizationPayload } from "../signing/authorization-payload.js";
import type { AuthorizeInput } from "../signing/authorize-input.js";
import type { SignerProcess } from "../signing/ports.js";
import type { PrivyRequest } from "../signing/privy-request.js";

/** A signer under test, and a request its hard rules let through. */
export interface SignerProcessSubject {
  readonly signerProcess: SignerProcess;
  readonly input: AuthorizeInput;
}

/** Makes a fresh {@link SignerProcessSubject} for each check. */
export interface SignerProcessHarness {
  create(): Promise<SignerProcessSubject>;
}

const live = (): { readonly signal: AbortSignal } => ({ signal: new AbortController().signal });

function verifies(publicKey: string, request: PrivyRequest, signature: string): boolean {
  const key = createPublicKey({
    key: Buffer.from(publicKey, "base64"),
    format: "der",
    type: "spki",
  });
  return verify("sha256", authorizationPayload(request), key, Buffer.from(signature, "base64"));
}

async function signed(subject: SignerProcessSubject): Promise<string> {
  const answer = await subject.signerProcess.authorize(subject.input, live());
  assert.ok(answer.ok, `expected a signature, got ${answer.ok ? "" : answer.error}`);
  return answer.value;
}

// The same request with one part changed: its body, its URL or one of the headers Privy signs.
function otherRequests(request: PrivyRequest): readonly PrivyRequest[] {
  return [
    { ...request, body: { method: "eth_signTransaction", params: {} } },
    { ...request, url: `${request.url}x` },
    { ...request, headers: { ...request.headers, "privy-request-expiry": "1" } },
  ];
}

/** The contract every `SignerProcess` adapter passes. */
export function signerProcessContract(harness: SignerProcessHarness): readonly ContractCheck[] {
  return [
    {
      name: "answers the agent key's public half as a P-256 key in DER SubjectPublicKeyInfo",
      run: async () => {
        const { signerProcess } = await harness.create();
        const key = createPublicKey({
          key: Buffer.from(await signerProcess.publicKey(live()), "base64"),
          format: "der",
          type: "spki",
        });
        assert.equal(key.asymmetricKeyDetails?.namedCurve, "prime256v1");
      },
    },
    {
      name: "signs Privy's payload of the request with the agent key, DER in base64",
      run: async () => {
        const subject = await harness.create();
        const publicKey = await subject.signerProcess.publicKey(live());
        assert.ok(verifies(publicKey, subject.input.request, await signed(subject)));
      },
    },
    {
      name: "signs that request only: not another body, URL or privy- header",
      run: async () => {
        const subject = await harness.create();
        const publicKey = await subject.signerProcess.publicKey(live());
        const signature = await signed(subject);
        const others = otherRequests(subject.input.request);
        assert.deepEqual(
          others.map((request) => verifies(publicKey, request, signature)),
          others.map(() => false),
        );
      },
    },
    {
      name: "answers and signs nothing on an aborted signal",
      run: async () => {
        const { signerProcess, input } = await harness.create();
        const reason = new Error("stopped");
        const aborted = { signal: AbortSignal.abort(reason) };
        await assert.rejects(signerProcess.publicKey(aborted), reason);
        await assert.rejects(signerProcess.authorize(input, aborted), reason);
      },
    },
  ];
}
