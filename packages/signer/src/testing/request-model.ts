import {
  accountRefSchema,
  chainRefSchema,
  type AuthorizeInput,
  type SignStep,
  type StepAction,
  type SignAuthorization,
} from "@binference/chain";
import { type Id, idSchema, type JsonValue } from "@binference/core";
import { approveCalldata, fixtureAddresses, transferCalldata } from "./sign-fixtures.js";

// A model of a request, written apart from the signer's code: the oracle below decides from the
// model alone whether a request keeps the hard rules, and the signer reads the request rendered
// from it. Every value comes from a small pool, so valid and broken requests both come up often.

export type Address = string;
export interface Account {
  readonly chain: string;
  readonly address: Address;
}
export type Data =
  | { readonly kind: "none" }
  | { readonly kind: "router" }
  | { readonly kind: "approve"; readonly account: Address; readonly amount: bigint }
  | { readonly kind: "transfer"; readonly account: Address; readonly amount: bigint }
  | { readonly kind: "transferFrom" };
export type Action =
  | { readonly kind: "call"; readonly nativeValue: bigint }
  | {
      readonly kind: "approve";
      readonly token: Account;
      readonly spender: Account;
      readonly amount: bigint;
    }
  | {
      readonly kind: "send";
      readonly recipient: Account;
      readonly amount: bigint;
      readonly token?: Account;
    };
type Replaces =
  | { readonly kind: "none" }
  | { readonly kind: "cancel"; readonly nonce: number }
  | {
      readonly kind: "speedUp";
      readonly nonce: number;
      readonly to: Account;
      readonly value: bigint;
      readonly data: Data;
    };
export type Authorization =
  | {
      readonly kind: "confirmation";
      readonly intent: string;
      readonly termsHash: string;
      readonly expiresAtMs: number;
    }
  | {
      readonly kind: "order" | "webhookRule";
      readonly state: string;
      readonly termsHash: string;
      readonly expiresAtMs?: number;
      readonly fills: number;
      readonly maxFills?: number;
    }
  | {
      readonly kind: "auto";
      readonly intent: string;
      readonly termsHash: string;
      readonly modeVersion: number;
      readonly grantAgent: string;
      readonly expiresAtMs: number;
      readonly agent: string;
      readonly mode: "auto" | "manual";
      readonly version: number;
      readonly cap: bigint;
    };

export interface Model {
  readonly enabled: readonly string[];
  readonly stepChain: string;
  readonly walletChain: string;
  readonly httpMethod: string;
  readonly urlWallet: string;
  readonly urlOrigin: string;
  readonly bodyMethod: string;
  readonly chainId: number | undefined;
  readonly to: Address | undefined;
  readonly value: bigint;
  readonly data: Data;
  readonly nonce: number;
  readonly fee: bigint | undefined;
  readonly type: 2 | 4 | undefined;
  readonly delegates: boolean;
  readonly action: Action;
  readonly replaces: Replaces;
  readonly contracts: readonly Account[];
  readonly spenders: readonly Account[];
  readonly recipients: readonly Account[];
  readonly authorization: Authorization;
  readonly termsHash: string;
  readonly nowMs: number;
}

export const c56 = "eip155:56";
export const c97 = "eip155:97";
export const api = "https://api.privy.io";
export const custodyId = "fmfdj6yqly31huorjqzq38zc";
const { wallet } = fixtureAddresses;
export const intents: readonly string[] = [
  "int_0192f3a4-5b6c-7d8e-9f00-112233445566",
  "int_0192f3a4-5b6c-7d8e-9f00-aabbccddeeff",
];
export const hashes: readonly string[] = ["ab".repeat(32), "cd".repeat(32)];
export const agents: readonly string[] = [
  "agt_0192f3a4-5b6c-7d8e-9f00-112233445566",
  "agt_0192f3a4-5b6c-7d8e-9f00-aabbccddeeff",
];
export const nowMs = 1_800_000_000_000;
export const gwei: bigint = 10n ** 9n;
export const unlimited: bigint = 2n ** 256n - 1n;
export const on = (address: Address, chain: string = c56): Account => ({ chain, address });

// Rendering a model as the request the engine would send.
const fixedCalldata: Readonly<Record<"none" | "router" | "transferFrom", string>> = {
  none: "0x",
  router: "0x7ff36ab5",
  transferFrom: `0x23b872dd${"0".repeat(192)}`,
};

function calldata(data: Data): string {
  if (data.kind === "approve") {
    return approveCalldata(data.account, data.amount);
  }
  return data.kind === "transfer"
    ? transferCalldata(data.account, data.amount)
    : fixedCalldata[data.kind];
}

const account = (a: Account) => accountRefSchema.parse(`${a.chain}:${a.address}`);
const id = <P extends string>(prefix: P): Id<P> =>
  idSchema(prefix).parse(`${prefix}_0192f3a4-5b6c-7d8e-9f00-112233445566`);

function authorizationOf(a: Authorization): SignAuthorization {
  if (a.kind === "confirmation") {
    const { intent, ...rest } = a;
    return { ...rest, id: id("cnf"), intent: idSchema("int").parse(intent) };
  }
  if (a.kind === "auto") {
    const { termsHash, modeVersion, mode, version, cap, expiresAtMs } = a;
    const grant = {
      approvalMode: "auto" as const,
      agent: idSchema("agt").parse(a.grantAgent),
      intent: idSchema("int").parse(a.intent),
      kind: "swap" as const,
      modeVersion,
      termsHash,
      grantedAtMs: nowMs - 1,
      expiresAtMs,
      networkFeeCapNativeBase: cap,
    };
    return {
      kind: "approvalMode",
      grant,
      current: { agent: idSchema("agt").parse(a.agent), mode, version },
    };
  }
  const { kind, ...advance } = a;
  return kind === "order"
    ? { kind, id: id("ord"), ...advance }
    : { kind, id: id("whr"), ...advance };
}

function transactionOf(m: Model): JsonValue {
  return {
    ...(m.to === undefined ? {} : { to: m.to }),
    value: `0x${m.value.toString(16)}`,
    ...(m.chainId === undefined ? {} : { chain_id: m.chainId }),
    data: calldata(m.data),
    nonce: m.nonce,
    ...(m.fee === undefined ? {} : { max_fee_per_gas: `0x${m.fee.toString(16)}` }),
    ...(m.type === undefined ? {} : { type: m.type }),
    ...(m.delegates ? { authorization_list: [] } : {}),
  };
}

function actionOf(action: Action): StepAction {
  if (action.kind === "call") {
    return action;
  }
  if (action.kind === "approve") {
    return { ...action, token: account(action.token), spender: account(action.spender) };
  }
  const { recipient, amount, token: sent } = action;
  return {
    kind: "send",
    recipient: account(recipient),
    amount,
    ...(sent === undefined ? {} : { token: account(sent) }),
  };
}

function replacesOf(replaces: Replaces): Pick<SignStep, "replaces"> {
  if (replaces.kind === "none") {
    return {};
  }
  if (replaces.kind === "cancel") {
    return { replaces };
  }
  const original = {
    to: account(replaces.to),
    value: replaces.value,
    data: calldata(replaces.data),
  };
  return { replaces: { kind: "speedUp", nonce: replaces.nonce, original } };
}

const bodyOf = (m: Model): JsonValue =>
  m.bodyMethod === "eth_signTransaction"
    ? { method: m.bodyMethod, params: { transaction: transactionOf(m) } }
    : { method: m.bodyMethod, params: { message: "hi" } };

export function render(m: Model): AuthorizeInput {
  return {
    wallet: { id: id("wal"), custodyId, account: account(on(wallet, m.walletChain)) },
    request: {
      method: m.httpMethod,
      url: `${m.urlOrigin}/v1/wallets/${m.urlWallet}/rpc`,
      headers: { "privy-app-id": "cm4xb2l3c00000000000000000" },
      body: bodyOf(m),
    },
    intent: idSchema("int").parse(intents[0]),
    step: {
      index: 0,
      chain: chainRefSchema.parse(m.stepChain),
      action: actionOf(m.action),
      ...replacesOf(m.replaces),
    },
    authorization: authorizationOf(m.authorization),
    termsHash: m.termsHash,
    allowed: {
      contracts: m.contracts.map(account),
      spenders: m.spenders.map(account),
      recipients: m.recipients.map(account),
    },
  };
}
