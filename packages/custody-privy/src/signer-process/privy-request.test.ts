import type { JsonValue } from "@binference/core";
import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import { type PrivyRequest, signaturePayload } from "./privy-request.js";

const url = "https://api.privy.io/v1/wallets/abc/rpc";
const headers = { "privy-app-id": "app" };

function payloadOf(body: JsonValue): string {
  return signaturePayload({ method: "POST", url, body, headers });
}

function wrapped(canonicalBody: string): string {
  return `{"body":${canonicalBody},"headers":{"privy-app-id":"app"},"method":"POST","url":"${url}","version":1}`;
}

describe("signaturePayload", () => {
  it("writes RFC 8785's sample of numbers, strings and literals as the RFC does", () => {
    const body = JSON.parse(
      '{"numbers":[333333333.33333329,1E30,4.50,2e-3,0.000000000000000000000000001],' +
        '"string":"\\u20ac$\\u000F\\u000aA\'\\u0042\\u0022\\u005c\\\\\\"\\/","literals":[null,true,false]}',
    ) as JsonValue;
    const canonical =
      '{"literals":[null,true,false],"numbers":[333333333.3333333,1e+30,4.5,0.002,1e-27],' +
      '"string":"€$\\u000f\\nA\'B\\"\\\\\\\\\\"/"}';
    expect(payloadOf(body)).toBe(wrapped(canonical));
  });

  it("sorts keys by UTF-16 code units, as RFC 8785's sorting sample does", () => {
    const body = JSON.parse(
      '{"\\u20ac":"Euro Sign","\\r":"Carriage Return","\\ufb33":"Hebrew Letter Dalet With Dagesh",' +
        '"1":"One","\\ud83d\\ude00":"Emoji: Grinning Face","\\u0080":"Control",' +
        '"\\u00f6":"Latin Small Letter O With Diaeresis"}',
    ) as Record<string, string>;
    // Code points, so the file holds no emoji: carriage return, 1, U+0080, o umlaut, euro, a
    // grinning face (two UTF-16 code units), Hebrew dalet with dagesh.
    const order = [0x0d, 0x31, 0x80, 0xf6, 0x20ac, 0x1f600, 0xfb33].map((code) =>
      String.fromCodePoint(code),
    );
    const fields = order.map((key) => `${JSON.stringify(key)}:${JSON.stringify(body[key])}`);
    expect(payloadOf(body)).toBe(wrapped(`{${fields.join(",")}}`));
  });

  it("covers the version, the method, the URL, the body and the privy headers, with no spaces", () => {
    const request: PrivyRequest = {
      method: "POST",
      url,
      body: {
        method: "eth_signTransaction",
        params: { transaction: { to: "0xAb", chain_id: 56 } },
      },
      headers: { "privy-request-expiry": "1700000000000", "privy-app-id": "app" },
    };
    expect(signaturePayload(request)).toBe(
      '{"body":{"method":"eth_signTransaction","params":{"transaction":{"chain_id":56,"to":"0xAb"}}},' +
        `"headers":{"privy-app-id":"app","privy-request-expiry":"1700000000000"},"method":"POST","url":"${url}","version":1}`,
    );
  });

  it("gives one payload whatever order the body's keys were written in", () => {
    fc.assert(
      fc.property(fc.dictionary(fc.string(), fc.jsonValue()), (record) => {
        const reversed = Object.fromEntries(Object.entries(record).toReversed());
        expect(payloadOf(reversed as JsonValue)).toBe(payloadOf(record as JsonValue));
      }),
    );
  });
});
