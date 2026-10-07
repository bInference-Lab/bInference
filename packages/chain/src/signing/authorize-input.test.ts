import { idSchema } from "@binference/core";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { accountRefSchema } from "../caip/account-ref.js";
import { chainRefSchema } from "../caip/chain-ref.js";
import { type AuthorizeInput, authorizeInputSchema } from "./authorize-input.js";
import type { SignAuthorization } from "./sign-authorization.js";
import type { SignStep } from "./sign-step.js";

const uuid = "0192f3a4-5b6c-7d8e-9f00-112233445566";
const chain = chainRefSchema.parse("fake:1");
const account = (address: string) => accountRefSchema.parse(`${chain}:${address}`);
const intent = idSchema("int").parse(`int_${uuid}`);
const agent = idSchema("agt").parse(`agt_${uuid}`);
const termsHash = "ab".repeat(32);
const nowMs = 1_800_000_000_000;

const base: AuthorizeInput = {
  wallet: { id: idSchema("wal").parse(`wal_${uuid}`), custodyId: "w1", account: account("0x0a") },
  request: {
    method: "POST",
    url: "https://privy.test/v1/wallets/w1/rpc",
    headers: { "privy-app-id": "app", "privy-request-expiry": "1800000300000" },
    body: { method: "eth_signTransaction", params: { transaction: { nonce: 7, data: "0x" } } },
  },
  intent,
  step: { index: 0, chain, action: { kind: "call", nativeValue: 10n ** 16n } },
  authorization: {
    kind: "confirmation",
    id: idSchema("cnf").parse(`cnf_${uuid}`),
    intent,
    termsHash,
    expiresAtMs: nowMs + 60_000,
  },
  termsHash,
  allowed: { contracts: [account("0x0b")], spenders: [account("0x0b")], recipients: [] },
};

const steps: readonly SignStep[] = [
  base.step,
  {
    index: 1,
    chain,
    action: {
      kind: "approve",
      token: account("0x0c"),
      spender: account("0x0b"),
      amount: 2n ** 255n,
    },
  },
  {
    index: 0,
    chain,
    action: { kind: "send", recipient: account("0x0d"), amount: 5n },
    replaces: { kind: "cancel", nonce: 3 },
  },
  {
    index: 0,
    chain,
    action: { kind: "send", recipient: account("0x0d"), amount: 5n, token: account("0x0c") },
    replaces: {
      kind: "speedUp",
      nonce: 3,
      original: { to: account("0x0c"), value: 0n, data: "0xa9059cbb" },
    },
  },
];

const authorizations: readonly SignAuthorization[] = [
  base.authorization,
  {
    kind: "order",
    id: idSchema("ord").parse(`ord_${uuid}`),
    state: "active",
    termsHash,
    fills: 2,
    maxFills: 5,
    expiresAtMs: nowMs,
  },
  {
    kind: "webhookRule",
    id: idSchema("whr").parse(`whr_${uuid}`),
    state: "active",
    termsHash,
    fills: 0,
  },
  {
    kind: "approvalMode",
    grant: {
      approvalMode: "auto",
      agent,
      intent,
      kind: "swap",
      modeVersion: 4,
      termsHash,
      grantedAtMs: nowMs,
      expiresAtMs: nowMs + 60_000,
      networkFeeCapNativeBase: 10n ** 9n,
    },
    current: { agent, mode: "auto", version: 4 },
  },
];

const throughJson = (input: unknown): unknown => JSON.parse(JSON.stringify(input)) as unknown;

const roundTrip = (input: AuthorizeInput) =>
  authorizeInputSchema.safeParse(throughJson(z.encode(authorizeInputSchema, input)));

describe("authorizeInputSchema", () => {
  it.each(steps.map((step) => [step.action.kind, step] as const))(
    "carries a %s step through JSON unchanged",
    (_kind, step) => {
      expect(roundTrip({ ...base, step })).toStrictEqual({
        success: true,
        data: { ...base, step },
      });
    },
  );

  it.each(authorizations.map((authorization) => [authorization.kind, authorization] as const))(
    "carries an authorization by %s through JSON unchanged",
    (_kind, authorization) => {
      expect(roundTrip({ ...base, authorization })).toStrictEqual({
        success: true,
        data: { ...base, authorization },
      });
    },
  );

  it.each([
    ["a number past 2^53 in the body", { body: { params: { nonce: 2 ** 53 } } }],
    ["a fraction in the body", { body: { params: { nonce: 1.5 } } }],
    ["a header Privy does not sign", { headers: { "privy-app-id": "a", authorization: "b" } }],
    ["a lowercase method", { method: "post" }],
    [
      "an expiry that is no number",
      { headers: { "privy-app-id": "a", "privy-request-expiry": "soon" } },
    ],
  ])("refuses a request with %s", (_case, change: Readonly<Record<string, unknown>>) => {
    const wire = throughJson(z.encode(authorizeInputSchema, base)) as { request: object };
    const changed = { ...wire, request: { ...wire.request, ...change } };

    expect(authorizeInputSchema.safeParse(changed).success).toBe(false);
  });

  it("refuses a field the request does not name, and an authorization of another kind", () => {
    const wire = throughJson(z.encode(authorizeInputSchema, base)) as { authorization: object };

    expect(authorizeInputSchema.safeParse({ ...wire, extra: 1 }).success).toBe(false);
    expect(
      authorizeInputSchema.safeParse({
        ...wire,
        authorization: { ...wire.authorization, kind: "tap" },
      }).success,
    ).toBe(false);
  });
});
