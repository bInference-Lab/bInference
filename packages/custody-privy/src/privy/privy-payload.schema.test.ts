import { authorizationPayload, type PrivyRequest } from "@binference/chain";
import { describe, expect, it } from "vitest";
import { readPayload } from "./privy-payload.schema.js";

const request: PrivyRequest = {
  method: "POST",
  url: "https://api.privy.io/v1/wallets/abc/rpc",
  body: { method: "eth_signTransaction", params: { transaction: { chain_id: 56 } } },
  headers: { "privy-app-id": "app", "privy-request-expiry": "1790000300000" },
};

const bytes = (text: string): Uint8Array => new TextEncoder().encode(text);

describe("readPayload", () => {
  it("reads back the request of a canonical payload", () => {
    expect(readPayload(authorizationPayload(request))).toStrictEqual(request);
  });

  it("reads nothing from a payload whose text is not canonical, so the signer signs only those bytes", () => {
    const spaced = JSON.stringify(
      JSON.parse(authorizationPayload(request).toString("utf8")),
      null,
      1,
    );
    const { version, ...rest } = JSON.parse(
      authorizationPayload(request).toString("utf8"),
    ) as Record<string, unknown>;
    const reordered = JSON.stringify({ version, ...rest });
    expect(readPayload(bytes(spaced))).toBeUndefined();
    expect(readPayload(bytes(reordered))).toBeUndefined();
  });

  it("reads nothing from another shape, another method, a header Privy does not sign, or bytes that are no UTF-8", () => {
    const payloads = [
      { ...request, version: 2 },
      { ...request, version: 1, method: "GET" },
      { ...request, version: 1, headers: { authorization: "Basic x" } },
      { ...request, version: 1, extra: true },
    ].map((item) => bytes(JSON.stringify(item)));
    for (const payload of [...payloads, new Uint8Array([0xff, 0xfe]), bytes("not json")]) {
      expect(readPayload(payload)).toBeUndefined();
    }
  });
});
