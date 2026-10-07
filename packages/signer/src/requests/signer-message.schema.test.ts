import type { AuthorizeInput } from "@binference/chain";
import { describe, expect, it } from "vitest";
import { authorizeFixture } from "../testing/sign-fixtures.js";
import { formatSignerRequest, readSignerLine, readSignerRequest } from "./signer-message.schema.js";

const base = authorizeFixture();

const roundTrip = (input: AuthorizeInput) =>
  readSignerRequest(formatSignerRequest({ id: "r1", kind: "authorize", ...input }));

describe("signer messages", () => {
  it("carries an authorize request through its line unchanged", () => {
    expect(roundTrip(base)).toStrictEqual({
      ok: true,
      request: { id: "r1", kind: "authorize", ...base },
    });
  });

  it.each([
    [
      "a number past 2^53 in the body",
      { method: "eth_signTransaction", params: { nonce: 2 ** 53 } },
    ],
    ["a fraction in the body", { method: "eth_signTransaction", params: { nonce: 1.5 } }],
  ])("refuses %s as malformed", (_case, body) => {
    expect(roundTrip({ ...base, request: { ...base.request, body } })).toStrictEqual({
      ok: false,
      id: "r1",
      refused: "malformed",
    });
  });

  it.each([
    [
      "a header Privy does not sign",
      { ...base.request, headers: { "privy-app-id": "a", authorization: "b" } },
    ],
    ["a lowercase method", { ...base.request, method: "post" }],
    [
      "an expiry that is no number",
      { ...base.request, headers: { "privy-app-id": "a", "privy-request-expiry": "soon" } },
    ],
  ])("refuses a request with %s as malformed", (_case, request) => {
    const line = formatSignerRequest({ id: "r1", kind: "authorize", ...base }).replace(
      JSON.stringify(base.request),
      JSON.stringify(request),
    );

    expect(readSignerRequest(line)).toStrictEqual({ ok: false, id: "r1", refused: "malformed" });
  });

  it("reads every answer and fault the signer writes, and nothing else", () => {
    const lines = [
      { id: "r1", ok: true, publicKey: "AAAA" },
      { id: "r2", ok: true, signature: "MEQC" },
      { id: null, ok: false, refused: "unknown_request" },
      { id: "r3", ok: false, refused: "rule_6" },
      { fault: "signer.not_sealed" },
    ];

    expect(lines.map((line) => readSignerLine(JSON.stringify(line)))).toStrictEqual(lines);
    expect(
      ["", "{}", "[]", '{"fault":"signer.other"}', '{"id":"r4","ok":false,"refused":"rule_7"}'].map(
        readSignerLine,
      ),
    ).toStrictEqual([undefined, undefined, undefined, undefined, undefined]);
  });
});
