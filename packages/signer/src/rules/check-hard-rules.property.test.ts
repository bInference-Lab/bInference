import { chainRefSchema } from "@binference/chain";
import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import { createP256KeyPair } from "../keys/p256-key-pair.js";
import { createSignerService } from "../process/signer-service.js";
import { formatSignerRequest } from "../requests/signer-message.schema.js";
import {
  type Account,
  type Action,
  type Address,
  agents,
  api,
  type Authorization,
  c56,
  c97,
  custodyId,
  type Data,
  gwei,
  hashes,
  intents,
  type Model,
  nowMs,
  on,
  render,
  unlimited,
} from "../testing/request-model.js";
import { fixtureAddresses } from "../testing/sign-fixtures.js";

// The oracle decides from a model of a request alone, written apart from the signer's code,
// whether the request keeps the hard rules; the signer answers the request rendered from the
// model. Every value comes from a small pool, so valid and broken requests both come up often.

const { wallet, router, token, saved, stranger } = fixtureAddresses;

// The oracle: the six rules of the keys spec, section 5.2, over the model.
const sameAccount = (account: Account, chain: string, address: Address | undefined): boolean =>
  account.chain === chain && account.address === address;
const listed = (list: readonly Account[], chain: string, address: Address | undefined): boolean =>
  list.some((account) => sameAccount(account, chain, address));
type Send = Extract<Action, { kind: "send" }>;
type Approve = Extract<Action, { kind: "approve" }>;

function approvalTargetOk(m: Model, action: Approve): boolean {
  const { data, stepChain: chain } = m;
  return (
    sameAccount(action.token, chain, m.to) &&
    data.kind === "approve" &&
    sameAccount(action.spender, chain, data.account) &&
    listed(m.spenders, chain, data.account)
  );
}

function sendTargetOk(m: Model, action: Send): boolean {
  const { data, stepChain: chain } = m;
  if (action.token === undefined) {
    return (
      sameAccount(action.recipient, chain, m.to) &&
      listed(m.recipients, chain, m.to) &&
      data.kind === "none"
    );
  }
  return (
    sameAccount(action.token, chain, m.to) &&
    data.kind === "transfer" &&
    sameAccount(action.recipient, chain, data.account) &&
    listed(m.recipients, chain, data.account)
  );
}

function targetOk(m: Model): boolean {
  const { action } = m;
  if (action.kind === "call") {
    return listed(m.contracts, m.stepChain, m.to);
  }
  return action.kind === "approve" ? approvalTargetOk(m, action) : sendTargetOk(m, action);
}

const grants = (m: Model, action: Approve): boolean =>
  m.value === 0n &&
  m.data.kind === "approve" &&
  m.data.amount <= action.amount &&
  m.data.amount < 2n ** 255n;
const pays = (m: Model, action: Send): boolean =>
  action.token === undefined
    ? m.value === action.amount
    : m.value === 0n && m.data.kind === "transfer" && m.data.amount === action.amount;

function valueOk(m: Model): boolean {
  const { action } = m;
  if (action.kind === "call") {
    return m.value === action.nativeValue && (m.data.kind === "none" || m.data.kind === "router");
  }
  return action.kind === "approve" ? grants(m, action) : pays(m, action);
}

function autoOk(m: Model, a: Extract<Authorization, { kind: "auto" }>): boolean {
  const feeOk =
    m.replaces.kind === "cancel" ||
    (m.action.kind !== "send" && m.fee !== undefined && m.fee <= a.cap);
  const grantHolds = a.intent === intents[0] && a.grantAgent === a.agent && m.nowMs < a.expiresAtMs;
  return grantHolds && a.mode === "auto" && a.version === a.modeVersion && feeOk;
}

function advanceOk(
  m: Model,
  a: Extract<Authorization, { kind: "order" | "webhookRule" }>,
): boolean {
  const unexpired = a.expiresAtMs === undefined || m.nowMs < a.expiresAtMs;
  const fillsLeft = a.maxFills === undefined || a.fills < a.maxFills;
  return a.state === "active" && unexpired && fillsLeft;
}

function authorizationOk(m: Model): boolean {
  const a = m.authorization;
  if (a.termsHash !== m.termsHash) {
    return false;
  }
  if (a.kind === "confirmation") {
    return a.intent === intents[0] && m.nowMs < a.expiresAtMs;
  }
  return a.kind === "auto" ? autoOk(m, a) : advanceOk(m, a);
}

function replacementOk(m: Model): boolean {
  const r = m.replaces;
  if (r.kind === "none") {
    return true;
  }
  if (r.kind === "cancel") {
    return (
      r.nonce === m.nonce &&
      m.to === wallet &&
      m.value === 0n &&
      m.data.kind === "none" &&
      m.walletChain === m.stepChain
    );
  }
  return (
    r.nonce === m.nonce &&
    sameAccount(r.to, m.stepChain, m.to) &&
    r.value === m.value &&
    sameData(r.data, m.data)
  );
}

const sameData = (left: Data, right: Data): boolean =>
  left.kind === right.kind &&
  ("amount" in left
    ? "amount" in right && left.amount === right.amount && left.account === right.account
    : true);

const chainOk = (m: Model): boolean =>
  m.enabled.includes(m.stepChain) &&
  `eip155:${String(m.chainId)}` === m.stepChain &&
  m.walletChain === m.stepChain;

const methodOk = (m: Model): boolean =>
  m.bodyMethod === "eth_signTransaction" &&
  m.httpMethod === "POST" &&
  m.urlOrigin === api &&
  m.urlWallet === custodyId &&
  !m.delegates &&
  m.type !== 4;

function insideTheRules(m: Model): boolean {
  const planOk = m.replaces.kind === "cancel" || (targetOk(m) && valueOk(m));
  return chainOk(m) && planOk && methodOk(m) && authorizationOk(m) && replacementOk(m);
}

// Requests every rule passes, one per kind of step, then random changes to them.
const routerCall: Model = {
  enabled: [c56],
  stepChain: c56,
  walletChain: c56,
  httpMethod: "POST",
  urlWallet: custodyId,
  urlOrigin: api,
  bodyMethod: "eth_signTransaction",
  chainId: 56,
  to: router,
  value: 10n ** 16n,
  data: { kind: "router" },
  nonce: 7,
  fee: gwei,
  type: 2,
  delegates: false,
  action: { kind: "call", nativeValue: 10n ** 16n },
  replaces: { kind: "none" },
  contracts: [on(router)],
  spenders: [on(router)],
  recipients: [on(saved)],
  authorization: {
    kind: "confirmation",
    intent: intents[0] ?? "",
    termsHash: hashes[0] ?? "",
    expiresAtMs: nowMs + 60_000,
  },
  termsHash: hashes[0] ?? "",
  nowMs,
};
const valid: readonly Model[] = [
  routerCall,
  {
    ...routerCall,
    to: token,
    value: 0n,
    data: { kind: "approve", account: router, amount: 900n },
    action: { kind: "approve", token: on(token), spender: on(router), amount: 1000n },
  },
  // A plan whose own amount is unlimited: the approval it grants must still stay below that.
  {
    ...routerCall,
    to: token,
    value: 0n,
    data: { kind: "approve", account: router, amount: 900n },
    action: { kind: "approve", token: on(token), spender: on(router), amount: unlimited },
  },
  {
    ...routerCall,
    to: saved,
    value: 5n,
    data: { kind: "none" },
    action: { kind: "send", recipient: on(saved), amount: 5n },
  },
  {
    ...routerCall,
    to: token,
    value: 0n,
    data: { kind: "transfer", account: saved, amount: 5n },
    action: { kind: "send", recipient: on(saved), amount: 5n, token: on(token) },
  },
  {
    ...routerCall,
    to: wallet,
    value: 0n,
    data: { kind: "none" },
    nonce: 3,
    replaces: { kind: "cancel", nonce: 3 },
  },
  {
    ...routerCall,
    nonce: 3,
    replaces: {
      kind: "speedUp",
      nonce: 3,
      to: on(router),
      value: 10n ** 16n,
      data: { kind: "router" },
    },
  },
  {
    ...routerCall,
    authorization: {
      kind: "order",
      state: "active",
      termsHash: hashes[0] ?? "",
      expiresAtMs: nowMs + 1,
      fills: 1,
      maxFills: 2,
    },
  },
  {
    ...routerCall,
    authorization: { kind: "webhookRule", state: "active", termsHash: hashes[0] ?? "", fills: 0 },
  },
  {
    ...routerCall,
    authorization: {
      kind: "auto",
      intent: intents[0] ?? "",
      termsHash: hashes[0] ?? "",
      modeVersion: 2,
      grantAgent: agents[0] ?? "",
      expiresAtMs: nowMs + 60_000,
      agent: agents[0] ?? "",
      mode: "auto",
      version: 2,
      cap: gwei,
    },
  },
];

const address = fc.constantFrom(wallet, router, token, saved, stranger);
const chain = fc.constantFrom(c56, c56, c56, c97);
const someAccount = fc.record({ chain, address });
const amount = fc.oneof(
  fc.constantFrom(0n, 5n, 900n, 1000n, 1001n, 10n ** 16n, 2n ** 255n - 1n, 2n ** 255n, unlimited),
  fc.bigInt({ min: 0n, max: 2n ** 256n - 1n }),
);
const data: fc.Arbitrary<Data> = fc.oneof(
  fc.constant({ kind: "none" as const }),
  fc.constant({ kind: "router" as const }),
  fc.constant({ kind: "transferFrom" as const }),
  fc.record({ kind: fc.constant("approve" as const), account: address, amount }),
  fc.record({ kind: fc.constant("transfer" as const), account: address, amount }),
);
const accounts = fc.array(someAccount, { maxLength: 3 });
const time = fc.constantFrom(nowMs - 1, nowMs, nowMs + 1, nowMs + 60_000);

type Change = (m: Model) => Model;
type Auto = Extract<Authorization, { kind: "auto" }>;

// One field of an auto grant or of the mode as it stands, when the model is authorized by auto.
const autoChange = (field: fc.Arbitrary<Partial<Auto>>): fc.Arbitrary<Change> =>
  field.map(
    (fields): Change =>
      (m) =>
        m.authorization.kind === "auto"
          ? { ...m, authorization: { ...m.authorization, ...fields } }
          : m,
  );
const autoChanges: readonly fc.Arbitrary<Change>[] = [
  autoChange(fc.record({ intent: fc.constantFrom(...intents) })),
  autoChange(fc.record({ termsHash: fc.constantFrom(...hashes) })),
  autoChange(fc.record({ grantAgent: fc.constantFrom(...agents) })),
  autoChange(fc.record({ agent: fc.constantFrom(...agents) })),
  autoChange(fc.record({ expiresAtMs: time })),
  autoChange(fc.record({ mode: fc.constantFrom("auto" as const, "manual" as const) })),
  autoChange(fc.record({ version: fc.nat(3) })),
  autoChange(fc.record({ cap: fc.constantFrom(gwei - 1n, gwei, gwei + 1n) })),
];
type SpeedUp = Extract<Model["replaces"], { kind: "speedUp" }>;

// One field of the call a speed-up repeats, when the model is a speed-up.
const speedUpChange = (field: fc.Arbitrary<Partial<SpeedUp>>): fc.Arbitrary<Change> =>
  field.map(
    (fields): Change =>
      (m) =>
        m.replaces.kind === "speedUp" ? { ...m, replaces: { ...m.replaces, ...fields } } : m,
  );
const speedUpChanges: readonly fc.Arbitrary<Change>[] = [
  speedUpChange(fc.record({ nonce: fc.constantFrom(3, 7) })),
  speedUpChange(fc.record({ to: someAccount })),
  speedUpChange(fc.record({ value: amount })),
  speedUpChange(fc.record({ data })),
];

const change: fc.Arbitrary<Change> = fc.oneof(
  ...autoChanges,
  ...speedUpChanges,
  fc.subarray([c56, c97]).map((enabled): Change => (m) => ({ ...m, enabled })),
  chain.map((stepChain): Change => (m) => ({ ...m, stepChain })),
  chain.map((walletChain): Change => (m) => ({ ...m, walletChain })),
  fc.constantFrom("POST", "PUT").map((httpMethod): Change => (m) => ({ ...m, httpMethod })),
  fc.constantFrom(custodyId, "otherwallet").map((urlWallet): Change => (m) => ({
    ...m,
    urlWallet,
  })),
  fc.constantFrom(api, "https://api.example.com").map((urlOrigin): Change => (m) => ({
    ...m,
    urlOrigin,
  })),
  fc.constantFrom("eth_signTransaction", "personal_sign").map((bodyMethod): Change => (m) => ({
    ...m,
    bodyMethod,
  })),
  fc.option(fc.constantFrom(56, 97, 1), { nil: undefined }).map((chainId): Change => (m) => ({
    ...m,
    chainId,
  })),
  fc.option(address, { nil: undefined }).map((to): Change => (m) => ({ ...m, to })),
  amount.map((value): Change => (m) => ({ ...m, value })),
  data.map((next): Change => (m) => ({ ...m, data: next })),
  fc.constantFrom(3, 4, 7).map((nonce): Change => (m) => ({ ...m, nonce })),
  fc
    .option(fc.constantFrom(gwei - 1n, gwei, gwei + 1n), { nil: undefined })
    .map((fee): Change => (m) => ({ ...m, fee })),
  fc.constantFrom(2, 4).map((type): Change => (m) => ({ ...m, type: type === 4 ? 4 : 2 })),
  fc.boolean().map((delegates): Change => (m) => ({ ...m, delegates })),
  amount.map(
    (nativeValue): Change =>
      (m) =>
        m.action.kind === "call" ? { ...m, action: { kind: "call", nativeValue } } : m,
  ),
  fc.record({ token: someAccount, spender: someAccount, amount }).map((action): Change => (m) => ({
    ...m,
    action: { kind: "approve", ...action },
  })),
  fc
    .record({ recipient: someAccount, amount, token: fc.option(someAccount) })
    .map(({ token: sent, ...rest }): Change => (m) => ({
      ...m,
      action: sent === null ? { kind: "send", ...rest } : { kind: "send", ...rest, token: sent },
    })),
  fc.constantFrom(3, 4).map((nonce): Change => (m) => ({
    ...m,
    replaces: { kind: "cancel", nonce },
  })),
  fc
    .record({ nonce: fc.constantFrom(3, 7), to: someAccount, value: amount, data })
    .map((speedUp): Change => (m) => ({ ...m, replaces: { kind: "speedUp", ...speedUp } })),
  fc.constant<Change>((m) => ({ ...m, replaces: { kind: "none" } })),
  // The amount an approval grants or a token send pays, keeping its accounts.
  amount.map(
    (granted): Change =>
      (m) =>
        m.data.kind === "approve" || m.data.kind === "transfer"
          ? { ...m, data: { ...m.data, amount: granted } }
          : m,
  ),
  accounts.map((contracts): Change => (m) => ({ ...m, contracts })),
  accounts.map((spenders): Change => (m) => ({ ...m, spenders })),
  accounts.map((recipients): Change => (m) => ({ ...m, recipients })),
  fc.constantFrom(...hashes).map((termsHash): Change => (m) => ({ ...m, termsHash })),
  time.map((now): Change => (m) => ({ ...m, nowMs: now })),
  fc
    .record({
      intent: fc.constantFrom(...intents),
      termsHash: fc.constantFrom(...hashes),
      expiresAtMs: time,
    })
    .map((confirmation): Change => (m) => ({
      ...m,
      authorization: { kind: "confirmation", ...confirmation },
    })),
  fc
    .record({
      kind: fc.constantFrom("order" as const, "webhookRule" as const),
      state: fc.constantFrom("active", "active", "filled", "deleted"),
      termsHash: fc.constantFrom(...hashes),
      expiresAtMs: fc.option(time),
      fills: fc.nat(3),
      maxFills: fc.option(fc.nat(3)),
    })
    .map(({ expiresAtMs, maxFills, ...advance }): Change => (m) => ({
      ...m,
      authorization: {
        ...advance,
        ...(expiresAtMs === null ? {} : { expiresAtMs }),
        ...(maxFills === null ? {} : { maxFills }),
      },
    })),
  fc
    .record({
      intent: fc.constantFrom(...intents),
      termsHash: fc.constantFrom(...hashes),
      modeVersion: fc.nat(2),
      grantAgent: fc.constantFrom(...agents),
      expiresAtMs: time,
      agent: fc.constantFrom(...agents),
      mode: fc.constantFrom("auto" as const, "manual" as const),
      version: fc.nat(2),
      cap: fc.constantFrom(gwei - 1n, gwei, gwei + 1n),
    })
    .map((auto): Change => (m) => ({ ...m, authorization: { kind: "auto", ...auto } })),
);

const models = fc
  .tuple(fc.constantFrom(...valid), fc.array(change, { maxLength: 3 }))
  .map(([base, changes]) => changes.reduce((model, next) => next(model), base));

const agentKey = createP256KeyPair();

describe("the hard rules on random requests", () => {
  it("sign every request inside the rules and no request outside them", { timeout: 60_000 }, () => {
    // Every outcome, so the test shows that its requests fell on both sides of the rules.
    const outcomes: boolean[] = [];
    fc.assert(
      fc.property(models, (model) => {
        const service = createSignerService({
          agentKey,
          settings: { chains: model.enabled.map((c) => chainRefSchema.parse(c)), privyApi: api },
          now: () => model.nowMs,
        });
        const answer = service.answer(
          formatSignerRequest({ id: "r1", kind: "authorize", ...render(model) }),
        );
        outcomes.push(answer.ok);
        expect(answer.ok).toBe(insideTheRules(model));
      }),
      { numRuns: 4000 },
    );

    expect(outcomes.filter((signed) => signed).length).toBeGreaterThan(400);
    expect(outcomes.filter((signed) => !signed).length).toBeGreaterThan(400);
  });
});
