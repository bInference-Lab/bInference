import { createPublicKey, type KeyObject, verify } from "node:crypto";
import type { JsonValue } from "@binference/core";
import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import { createP256KeyPair, p256KeyPairFromScalar } from "../keys/p256-key-pair.js";
import { authorizationPayload, signAuthorization } from "./authorization-signature.js";
import type { PrivyRequest } from "./privy-request.schema.js";

// The example request of Privy's docs, "Implementing signing directly"
// (https://docs.privy.io/controls/authorization-keys/using-owners/sign/direct-implementation).
const docsExample: PrivyRequest = {
  method: "POST",
  url: "https://api.privy.io/v1/wallets/<wallet_id>/rpc",
  headers: { "privy-app-id": "insert-your-app-id" },
  body: { method: "personal_sign", params: { message: "Hello world" } },
};

// An eth_signTransaction request with an idempotency key, its fields written out of order.
const transactionRequest: PrivyRequest = {
  method: "POST",
  url: "https://api.privy.io/v1/wallets/fmfdj6yqly31huorjqzq38zc/rpc",
  headers: {
    "privy-idempotency-key": "int_0192f3a4-5b6c-7d8e-9f00-112233445566-1",
    "privy-app-id": "cm4xb2l3c00000000000000000",
  },
  body: {
    method: "eth_signTransaction",
    params: {
      transaction: {
        to: "0x13f4EA83D0bd40E75C8222255bc855a974568Dd4",
        value: "0x2386f26fc10000",
        chain_id: 56,
        nonce: 7,
        gas_limit: 300_000,
        max_fee_per_gas: "0x3b9aca00",
        max_priority_fee_per_gas: "0x0",
        type: 2,
        data: "0xabcdef",
      },
    },
  },
};

// Written by Privy's own SDK, @privy-io/node 0.35.0: formatRequestForAuthorizationSignature for the
// payload, and generateAuthorizationSignature with the test key below for the signature. That SDK
// signs with RFC 6979 nonces, so its signatures are fixed.
const sdkPayloads = {
  docs:
    '{"body":{"method":"personal_sign","params":{"message":"Hello world"}},' +
    '"headers":{"privy-app-id":"insert-your-app-id"},"method":"POST",' +
    '"url":"https://api.privy.io/v1/wallets/<wallet_id>/rpc","version":1}',
  transaction:
    '{"body":{"method":"eth_signTransaction","params":{"transaction":{"chain_id":56,' +
    '"data":"0xabcdef","gas_limit":300000,"max_fee_per_gas":"0x3b9aca00",' +
    '"max_priority_fee_per_gas":"0x0","nonce":7,"to":"0x13f4EA83D0bd40E75C8222255bc855a974568Dd4",' +
    '"type":2,"value":"0x2386f26fc10000"}}},"headers":{"privy-app-id":"cm4xb2l3c00000000000000000",' +
    '"privy-idempotency-key":"int_0192f3a4-5b6c-7d8e-9f00-112233445566-1"},"method":"POST",' +
    '"url":"https://api.privy.io/v1/wallets/fmfdj6yqly31huorjqzq38zc/rpc","version":1}',
};
const sdkSignatures = {
  docs: "MEQCIAwKfssgnPSTRjpnFX+xd7bYvc2p57+pszTIINYSmbtPAiBakbq65+pmMJK2wjaOqM2O2pDLGT2Gq9fL7UnFjVyThQ==",
  transaction:
    "MEUCIQCeoa5RCahxTfACkkeIV9F2WFbhURNXYxeIwn8J5Elt6AIgWm+lQzBMy0QW23OwuwV8Pd3/8bgMFC51o0wg9k8S5X8=",
};

// The test key with the scalar 1: its public half is the curve's generator point.
function testKey(): { readonly privateKey: KeyObject; readonly publicKey: KeyObject } {
  const pair = p256KeyPairFromScalar(Buffer.from(`${"00".repeat(31)}01`, "hex"));
  if (!pair.ok) {
    throw new Error("the test scalar makes no key");
  }
  return { privateKey: pair.value.privateKey, publicKey: createPublicKey(pair.value.privateKey) };
}

const verifies = (publicKey: KeyObject, payload: Buffer, signature: string): boolean =>
  verify("sha256", payload, publicKey, Buffer.from(signature, "base64"));

const jsonValue = fc.jsonValue() as fc.Arbitrary<JsonValue>;
const withBody = (body: JsonValue): PrivyRequest => ({ ...docsExample, body });

describe("the Privy authorization signature", () => {
  it.each([
    ["the docs example", docsExample, sdkPayloads.docs],
    ["an eth_signTransaction request", transactionRequest, sdkPayloads.transaction],
  ])("writes the payload of %s byte for byte as Privy's SDK does", (_case, request, payload) => {
    expect(authorizationPayload(request).toString("utf8")).toBe(payload);
  });

  it.each([
    ["the docs example", docsExample, sdkSignatures.docs],
    ["an eth_signTransaction request", transactionRequest, sdkSignatures.transaction],
  ])(
    "checks the SDK's signature over %s as Privy does, and ours the same way",
    (_case, request, sdkSignature) => {
      const key = testKey();
      const payload = authorizationPayload(request);
      const ours = signAuthorization(key.privateKey, request);

      expect(verifies(key.publicKey, payload, sdkSignature)).toBe(true);
      expect(verifies(key.publicKey, payload, ours)).toBe(true);
      expect(Buffer.from(ours, "base64").toString("base64")).toBe(ours);
      expect(Buffer.from(ours, "base64")[0]).toBe(0x30);
    },
  );

  it("signs the same payload whatever order the fields were written in", () => {
    fc.assert(
      fc.property(fc.dictionary(fc.string(), jsonValue, { maxKeys: 8 }), (fields) => {
        const reversed = Object.fromEntries(Object.entries(fields).toReversed());
        expect(authorizationPayload(withBody(reversed))).toStrictEqual(
          authorizationPayload(withBody(fields)),
        );
      }),
    );
  });

  it("gives a signature that no longer holds once the method, URL, body or a header changes", () => {
    const key = createP256KeyPair();
    const publicKey = createPublicKey(key.privateKey);
    const signature = signAuthorization(key.privateKey, transactionRequest);
    const changed: readonly PrivyRequest[] = [
      { ...transactionRequest, method: "PUT" },
      { ...transactionRequest, url: `${transactionRequest.url}/` },
      { ...transactionRequest, body: { method: "eth_signTransaction", params: {} } },
      { ...transactionRequest, headers: { "privy-app-id": "cm4xb2l3c00000000000000000" } },
      {
        ...transactionRequest,
        headers: { ...transactionRequest.headers, "privy-request-expiry": "1" },
      },
    ];

    expect(verifies(publicKey, authorizationPayload(transactionRequest), signature)).toBe(true);
    expect(
      changed.map((request) => verifies(publicKey, authorizationPayload(request), signature)),
    ).toStrictEqual(changed.map(() => false));
  });
});
