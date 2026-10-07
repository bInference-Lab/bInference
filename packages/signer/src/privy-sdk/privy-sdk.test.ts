import { createPublicKey, verify } from "node:crypto";
import type { JsonValue } from "@binference/core";
import {
  formatRequestForAuthorizationSignature,
  generateAuthorizationSignature,
  type WalletApiRequestSignatureInput,
} from "@privy-io/node";
import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import { formatAgentKey } from "../agent-key/agent-key-text.js";
import { createP256KeyPair } from "../keys/p256-key-pair.js";
import { authorizationPayload, signAuthorization } from "../privy/authorization-signature.js";
import type { PrivyRequest } from "../privy/privy-request.schema.js";

// Privy's docs recommend its SDK for authorization signatures. The signer cannot load the SDK in
// its sealed process, so it writes the payload itself; this test holds it to the SDK's bytes, for
// any request, with the SDK as a test-only dependency.

const largestSafeInteger = 2 ** 53 - 1;
// JSON as a Privy body holds it: safe integers only, every string Unicode can write.
const body: fc.Arbitrary<JsonValue> = fc.letrec<{ value: JsonValue }>((tie) => ({
  value: fc.oneof(
    { depthSize: "small" },
    fc.constant(null),
    fc.boolean(),
    fc.integer({ min: -largestSafeInteger, max: largestSafeInteger }),
    fc.string({ unit: "binary" }),
    fc.array(tie("value"), { maxLength: 4 }),
    fc.dictionary(fc.string({ unit: "binary" }), tie("value"), { maxKeys: 4 }),
  ),
})).value;

const header = fc.stringMatching(/^[\x21-\x7e]{1,40}$/);
const request: fc.Arbitrary<PrivyRequest> = fc.record({
  method: fc.constantFrom("POST", "PUT", "PATCH", "DELETE"),
  url: fc.webUrl(),
  headers: fc.record(
    {
      "privy-app-id": header,
      "privy-idempotency-key": header,
      "privy-request-expiry": fc.integer({ min: 1, max: largestSafeInteger }).map(String),
    },
    { requiredKeys: ["privy-app-id"] },
  ),
  body,
});

// The SDK's input, a copy: the SDK writes over an empty body.
const sdkInput = (privy: PrivyRequest): WalletApiRequestSignatureInput =>
  structuredClone({ version: 1, ...privy }) as WalletApiRequestSignatureInput;

describe("the signer and Privy's Node SDK", () => {
  it("write the same payload bytes for any request", () => {
    fc.assert(
      fc.property(request, (privy) => {
        expect(authorizationPayload(privy)).toStrictEqual(
          Buffer.from(formatRequestForAuthorizationSignature(sdkInput(privy))),
        );
      }),
      { numRuns: 500 },
    );
  });

  it("write an empty object body as the SDK does", () => {
    const privy: PrivyRequest = {
      method: "DELETE",
      url: "https://api.privy.io/v1/wallets/w1",
      headers: { "privy-app-id": "app" },
      body: {},
    };

    expect(authorizationPayload(privy)).toStrictEqual(
      Buffer.from(formatRequestForAuthorizationSignature(sdkInput(privy))),
    );
  });

  it("sign so that the same key's SDK signature and ours both verify over those bytes", () => {
    const pair = createP256KeyPair();
    const publicKey = createPublicKey(pair.privateKey);
    fc.assert(
      fc.property(request, (privy) => {
        const payload = authorizationPayload(privy);
        const sdkSignature = generateAuthorizationSignature({
          authorizationPrivateKey: formatAgentKey(pair).reveal(),
          input: sdkInput(privy),
        });
        const ours = signAuthorization(pair.privateKey, privy);

        expect(verify("sha256", payload, publicKey, Buffer.from(sdkSignature, "base64"))).toBe(
          true,
        );
        expect(verify("sha256", payload, publicKey, Buffer.from(ours, "base64"))).toBe(true);
      }),
      { numRuns: 100 },
    );
  });
});
