import {
  accountRefSchema,
  chainRefSchema,
  type AuthorizeInput,
  type ApprovalModeNow,
  type AutoModeGrant,
  type SignStep,
  type SignAuthorization,
} from "@binference/chain";
import { idSchema } from "@binference/core";
import { describe, expect, it } from "vitest";
import type { SignerSettings } from "../process/signer-settings.schema.js";
import {
  accountOn,
  approveCalldata,
  authorizeFixture,
  fixtureAddresses,
  fixtureNowMs,
  fixtureSettings,
  fixtureTermsHash,
  transferCalldata,
  withTransaction,
} from "../testing/sign-fixtures.js";
import { brokenHardRules, checkHardRules, type HardRuleContext } from "./check-hard-rules.js";
import type { HardRule } from "./hard-rule.js";

const { wallet, router, token, saved, stranger } = fixtureAddresses;
const context: HardRuleContext = { settings: fixtureSettings, nowMs: fixtureNowMs };
const call = authorizeFixture();
const unlimited = 2n ** 256n - 1n;
const gwei = 10n ** 9n;

const withStep = (input: AuthorizeInput, step: Partial<SignStep>): AuthorizeInput => ({
  ...input,
  step: { ...input.step, ...step },
});
const withAuthorization = (
  input: AuthorizeInput,
  authorization: SignAuthorization,
): AuthorizeInput => ({
  ...input,
  authorization,
});

const approve = withStep(
  withTransaction(call, { to: token, value: "0x0", data: approveCalldata(router, 1000n) }),
  {
    action: { kind: "approve", token: accountOn(token), spender: accountOn(router), amount: 1000n },
  },
);
const nativeSend = withStep(withTransaction(call, { to: saved, value: 5, data: "0x" }), {
  action: { kind: "send", recipient: accountOn(saved), amount: 5n },
});
const tokenSend = withStep(
  withTransaction(call, { to: token, value: 0, data: transferCalldata(saved, 5n) }),
  { action: { kind: "send", recipient: accountOn(saved), amount: 5n, token: accountOn(token) } },
);
const cancel = withStep(withTransaction(call, { to: wallet, value: 0, data: "0x", nonce: 3 }), {
  replaces: { kind: "cancel", nonce: 3 },
});
const speedUp = withStep(withTransaction(call, { nonce: 3, max_fee_per_gas: "0x41cdb400" }), {
  replaces: {
    kind: "speedUp",
    nonce: 3,
    original: { to: accountOn(router), value: 10n ** 16n, data: "0x7ff36ab5" },
  },
});
const orderAuthorization: SignAuthorization = {
  kind: "order",
  id: idSchema("ord").parse("ord_0192f3a4-5b6c-7d8e-9f00-112233445566"),
  state: "active",
  termsHash: fixtureTermsHash,
  expiresAtMs: fixtureNowMs + 1,
  fills: 2,
  maxFills: 3,
};
const order = withAuthorization(call, orderAuthorization);
const webhookRule = withAuthorization(call, {
  ...orderAuthorization,
  kind: "webhookRule",
  id: idSchema("whr").parse("whr_0192f3a4-5b6c-7d8e-9f00-112233445566"),
});
const agent = idSchema("agt").parse("agt_0192f3a4-5b6c-7d8e-9f00-112233445566");
const grant: AutoModeGrant = {
  approvalMode: "auto",
  agent,
  intent: call.intent,
  kind: "swap",
  modeVersion: 4,
  termsHash: fixtureTermsHash,
  grantedAtMs: fixtureNowMs - 1,
  expiresAtMs: fixtureNowMs + 1,
  networkFeeCapNativeBase: gwei,
};
const autoAuthorization: SignAuthorization = {
  kind: "approvalMode",
  grant,
  current: { agent, mode: "auto", version: 4 },
};
const autoWith = (change: {
  readonly grant?: Partial<AutoModeGrant>;
  readonly current?: Partial<ApprovalModeNow>;
}): AuthorizeInput =>
  withAuthorization(call, {
    kind: "approvalMode",
    grant: { ...grant, ...change.grant },
    current: { agent, mode: "auto", version: 4, ...change.current },
  });
const auto = withAuthorization(call, autoAuthorization);
const autoCancel = withAuthorization(
  withTransaction(cancel, {
    to: wallet,
    value: 0,
    data: "0x",
    nonce: 3,
    max_fee_per_gas: "0x77359400",
  }),
  autoAuthorization,
);

const bases: readonly (readonly [string, AuthorizeInput])[] = [
  ["a venue call", call],
  ["an exact approval", approve],
  ["a native send", nativeSend],
  ["a token send", tokenSend],
  ["a cancel", cancel],
  ["a speed-up", speedUp],
  ["an auto order fill", order],
  ["a webhook rule fill", webhookRule],
  ["an auto mode trade", auto],
  ["a cancel in auto mode above the fee cap", autoCancel],
];

const otherChain = chainRefSchema.parse("eip155:97");
const otherIntent = idSchema("int").parse("int_0192f3a4-5b6c-7d8e-9f00-aabbccddeeff");
const settingsWith = (settings: Partial<SignerSettings>): HardRuleContext => ({
  ...context,
  settings: { ...fixtureSettings, ...settings },
});

// Each case changes one thing about a request every rule passes, and breaks one rule only.
const breaking: readonly (readonly [HardRule, string, AuthorizeInput, HardRuleContext?])[] = [
  [1, "a chain the owner has not enabled", call, settingsWith({ chains: [otherChain] })],
  [1, "a transaction on another chain than the step's", withTransaction(call, { chain_id: 97 })],
  [1, "a transaction that names no chain", withTransaction(call, {}, ["chain_id"])],
  [
    1,
    "a wallet account on another chain",
    { ...call, wallet: { ...call.wallet, account: accountRefSchema.parse(`eip155:97:${wallet}`) } },
  ],
  [2, "a call to a contract the venue did not declare", withTransaction(call, { to: stranger })],
  [2, "a contract creation", withTransaction(call, {}, ["to"])],
  [
    2,
    "a call to a declared contract on another chain",
    {
      ...call,
      allowed: { ...call.allowed, contracts: [accountRefSchema.parse(`eip155:97:${router}`)] },
    },
  ],
  [
    2,
    "an approval to a spender outside the registry",
    withStep(
      withTransaction(approve, { to: token, value: "0x0", data: approveCalldata(stranger, 10n) }),
      {
        action: {
          kind: "approve",
          token: accountOn(token),
          spender: accountOn(stranger),
          amount: 1000n,
        },
      },
    ),
  ],
  [
    2,
    "an approval sent to another token",
    withTransaction(approve, { to: router, value: "0x0", data: approveCalldata(router, 10n) }),
  ],
  [
    2,
    "a native send to an address that is not saved",
    withStep(withTransaction(nativeSend, { to: stranger, value: 5, data: "0x" }), {
      action: { kind: "send", recipient: accountOn(stranger), amount: 5n },
    }),
  ],
  [
    2,
    "a native send that also calls the recipient",
    withTransaction(nativeSend, { to: saved, value: 5, data: "0x7ff36ab5" }),
  ],
  [
    2,
    "a token send to another recipient",
    withTransaction(tokenSend, { to: token, value: 0, data: transferCalldata(stranger, 5n) }),
  ],
  [3, "a call with another native value", withTransaction(call, { value: "0x2386f26fc10001" })],
  [
    3,
    "a call that approves a token",
    withTransaction(call, { data: approveCalldata(stranger, 1n) }),
  ],
  [3, "a call that moves a token", withTransaction(call, { data: `0x23b872dd${"0".repeat(192)}` })],
  [
    3,
    "an approval above the step's amount",
    withTransaction(approve, { to: token, value: "0x0", data: approveCalldata(router, 1001n) }),
  ],
  [
    3,
    "an unlimited approval",
    withStep(
      withTransaction(approve, {
        to: token,
        value: "0x0",
        data: approveCalldata(router, unlimited),
      }),
      {
        action: {
          kind: "approve",
          token: accountOn(token),
          spender: accountOn(router),
          amount: unlimited,
        },
      },
    ),
  ],
  [
    3,
    "an approval that also sends the native coin",
    withTransaction(approve, { to: token, value: 1, data: approveCalldata(router, 1000n) }),
  ],
  [
    3,
    "a native send of another amount",
    withTransaction(nativeSend, { to: saved, value: 6, data: "0x" }),
  ],
  [
    3,
    "a token send of another amount",
    withTransaction(tokenSend, { to: token, value: 0, data: transferCalldata(saved, 6n) }),
  ],
  [
    3,
    "a token send that also sends the native coin",
    withTransaction(tokenSend, { to: token, value: 1, data: transferCalldata(saved, 5n) }),
  ],
  [
    4,
    "a request with another HTTP method",
    { ...call, request: { ...call.request, method: "PUT" } },
  ],
  [
    4,
    "a request for another wallet",
    { ...call, request: { ...call.request, url: "https://api.privy.io/v1/wallets/other/rpc" } },
  ],
  [
    4,
    "a request to another API",
    {
      ...call,
      request: {
        ...call.request,
        url: call.request.url.replace("api.privy.io", "api.example.com"),
      },
    },
  ],
  [
    4,
    "a personal_sign request",
    {
      ...call,
      request: { ...call.request, body: { method: "personal_sign", params: { message: "hi" } } },
    },
  ],
  [4, "an EIP-7702 authorization list", withTransaction(call, { authorization_list: [] })],
  [4, "an EIP-7702 transaction type", withTransaction(call, { type: 4 })],
  [5, "a terms hash other than the authorization's", { ...call, termsHash: "cd".repeat(32) }],
  [
    5,
    "a confirmation of another intent",
    withAuthorization(call, {
      kind: "confirmation",
      id: idSchema("cnf").parse("cnf_0192f3a4-5b6c-7d8e-9f00-112233445566"),
      intent: otherIntent,
      termsHash: fixtureTermsHash,
      expiresAtMs: fixtureNowMs + 60_000,
    }),
  ],
  [5, "an expired confirmation", call, { ...context, nowMs: fixtureNowMs + 60_000 }],
  [
    5,
    "an order that is no longer active",
    withAuthorization(call, { ...orderAuthorization, state: "filled" }),
  ],
  [5, "an expired order", order, { ...context, nowMs: fixtureNowMs + 1 }],
  [5, "an order at its last fill", withAuthorization(call, { ...orderAuthorization, fills: 3 })],
  [5, "an expired webhook rule", webhookRule, { ...context, nowMs: fixtureNowMs + 2 }],
  [5, "auto mode switched to manual", autoWith({ current: { mode: "manual", version: 5 } })],
  [5, "auto mode at another version", autoWith({ current: { version: 5 } })],
  [5, "an auto grant for another intent", autoWith({ grant: { intent: otherIntent } })],
  [
    5,
    "an auto grant of another agent",
    autoWith({
      current: { agent: idSchema("agt").parse("agt_0192f3a4-5b6c-7d8e-9f00-aabbccddeeff") },
    }),
  ],
  [5, "an auto grant over other terms", autoWith({ grant: { termsHash: "cd".repeat(32) } })],
  [5, "an expired auto grant", auto, { ...context, nowMs: fixtureNowMs + 1 }],
  [5, "a send in auto mode", withAuthorization(nativeSend, autoAuthorization)],
  [
    5,
    "a fee above the network fee cap in auto mode",
    withTransaction(auto, { max_fee_per_gas: "0x3b9aca01" }),
  ],
  [5, "no fee in auto mode", withTransaction(auto, {}, ["max_fee_per_gas"])],
  [
    6,
    "a cancel at another nonce",
    withTransaction(cancel, { to: wallet, value: 0, data: "0x", nonce: 4 }),
  ],
  [
    6,
    "a cancel to another address",
    withTransaction(cancel, { to: saved, value: 0, data: "0x", nonce: 3 }),
  ],
  [
    6,
    "a cancel that sends value",
    withTransaction(cancel, { to: wallet, value: 1, data: "0x", nonce: 3 }),
  ],
  [
    6,
    "a cancel with calldata",
    withTransaction(cancel, { to: wallet, value: 0, data: "0x00", nonce: 3 }),
  ],
  [6, "a speed-up at another nonce", withTransaction(speedUp, { nonce: 4 })],
  [
    6,
    "a speed-up of other calldata",
    withStep(speedUp, {
      replaces: {
        kind: "speedUp",
        nonce: 3,
        original: { to: accountOn(router), value: 10n ** 16n, data: "0x7ff36ab6" },
      },
    }),
  ],
  [
    6,
    "a speed-up of a call to another contract",
    withStep(speedUp, {
      replaces: {
        kind: "speedUp",
        nonce: 3,
        original: { to: accountOn(stranger), value: 10n ** 16n, data: "0x7ff36ab5" },
      },
    }),
  ],
  [
    6,
    "a speed-up of another value",
    withStep(speedUp, {
      replaces: {
        kind: "speedUp",
        nonce: 3,
        original: { to: accountOn(router), value: 1n, data: "0x7ff36ab5" },
      },
    }),
  ],
];

describe("the hard rules", () => {
  it.each(bases)("pass %s that keeps every rule", (_case, input) => {
    expect(brokenHardRules(input, context)).toStrictEqual([]);
    expect(checkHardRules(input, context)).toBeUndefined();
  });

  it.each(
    breaking.map(([rule, name, input, ruleContext = context]) => ({
      rule,
      name,
      input,
      ruleContext,
    })),
  )("break rule $rule, and that rule only, for $name", ({ rule, input, ruleContext }) => {
    expect(brokenHardRules(input, ruleContext)).toStrictEqual([rule]);
    expect(checkHardRules(input, ruleContext)).toBe(`rule_${String(rule)}`);
  });

  it.each([
    ["a body that is no Privy call", { nonsense: true }],
    [
      "a transaction with no nonce",
      { method: "eth_signTransaction", params: { transaction: { to: router } } },
    ],
    [
      "a transaction with a field Privy does not take",
      { method: "eth_signTransaction", params: { transaction: { nonce: 1, from: wallet } } },
    ],
    [
      "a quantity in decimal text",
      { method: "eth_signTransaction", params: { transaction: { nonce: "7" } } },
    ],
    [
      "params with more than the transaction",
      { method: "eth_signTransaction", params: { transaction: { nonce: 1 }, chain: 56 } },
    ],
  ])("refuse %s as malformed", (_case, body) => {
    expect(checkHardRules({ ...call, request: { ...call.request, body } }, context)).toBe(
      "malformed",
    );
  });

  it("reports the first of several broken rules", () => {
    const broken = withTransaction(
      { ...call, termsHash: "cd".repeat(32) },
      { to: stranger, chain_id: 97 },
    );

    expect(brokenHardRules(broken, context)).toStrictEqual([1, 2, 5]);
    expect(checkHardRules(broken, context)).toBe("rule_1");
  });
});
