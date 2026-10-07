import { idSchema } from "@binference/core";
import { describe, expect, it } from "vitest";
import {
  accountOn,
  authorizeFixture,
  fixtureAddresses,
  fixtureNowMs,
} from "../testing/sign-fixtures.js";
import type { AuthorizeInput } from "./authorize-input.schema.js";
import type { SignStep } from "./sign-step.schema.js";
import type { SignerAuthorization } from "./signer-authorization.schema.js";
import { formatSignerRequest, readSignerLine, readSignerRequest } from "./signer-message.schema.js";

const base = authorizeFixture();
const termsHash = base.termsHash;

const steps: readonly SignStep[] = [
  base.step,
  {
    index: 1,
    chain: base.step.chain,
    action: {
      kind: "approve",
      token: accountOn(fixtureAddresses.token),
      spender: accountOn(fixtureAddresses.router),
      amount: 2n ** 255n,
    },
  },
  {
    index: 0,
    chain: base.step.chain,
    action: { kind: "send", recipient: accountOn(fixtureAddresses.saved), amount: 5n },
    replaces: { kind: "cancel", nonce: 3 },
  },
  {
    index: 0,
    chain: base.step.chain,
    action: {
      kind: "send",
      recipient: accountOn(fixtureAddresses.saved),
      amount: 5n,
      token: accountOn(fixtureAddresses.token),
    },
    replaces: {
      kind: "speedUp",
      nonce: 3,
      original: { to: accountOn(fixtureAddresses.token), value: 0n, data: "0xa9059cbb" },
    },
  },
];

const authorizations: readonly SignerAuthorization[] = [
  base.authorization,
  {
    kind: "order",
    id: idSchema("ord").parse("ord_0192f3a4-5b6c-7d8e-9f00-112233445566"),
    state: "active",
    termsHash,
    fills: 2,
    maxFills: 5,
    expiresAtMs: fixtureNowMs,
  },
  {
    kind: "webhookRule",
    id: idSchema("whr").parse("whr_0192f3a4-5b6c-7d8e-9f00-112233445566"),
    state: "active",
    termsHash,
    fills: 0,
  },
  {
    kind: "approvalMode",
    grant: {
      approvalMode: "auto",
      agent: idSchema("agt").parse("agt_0192f3a4-5b6c-7d8e-9f00-112233445566"),
      intent: base.intent,
      kind: "swap",
      modeVersion: 4,
      termsHash,
      grantedAtMs: fixtureNowMs,
      expiresAtMs: fixtureNowMs + 60_000,
      networkFeeCapNativeBase: 10n ** 9n,
    },
    current: {
      agent: idSchema("agt").parse("agt_0192f3a4-5b6c-7d8e-9f00-112233445566"),
      mode: "auto",
      version: 4,
    },
  },
];

const roundTrip = (input: AuthorizeInput) =>
  readSignerRequest(formatSignerRequest({ id: "r1", kind: "authorize", ...input }));

describe("signer messages", () => {
  it.each(steps.map((step) => [step.action.kind, step] as const))(
    "carries a %s step through JSON unchanged",
    (_kind, step) => {
      expect(roundTrip({ ...base, step })).toStrictEqual({
        ok: true,
        request: { id: "r1", kind: "authorize", ...base, step },
      });
    },
  );

  it.each(authorizations.map((authorization) => [authorization.kind, authorization] as const))(
    "carries an authorization by %s through JSON unchanged",
    (_kind, authorization) => {
      expect(roundTrip({ ...base, authorization })).toStrictEqual({
        ok: true,
        request: { id: "r1", kind: "authorize", ...base, authorization },
      });
    },
  );

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
