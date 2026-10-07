import type { PrivyRequest } from "@binference/chain";
import { BinferenceError, err, ok, type Result } from "@binference/core";
import type { PrivyClient } from "@privy-io/node";
import type { Ceiling } from "../ceiling/ceiling.js";
import type { PolicyCondition, PolicyRule } from "../ceiling/policy-rule.js";
import type { PrivyTransaction } from "../signing/privy-transaction.js";
import { callPrivy, type PrivyCall, privyFault, statusFault } from "./privy-call.js";
import { type PrivyApiOptions, type PrivySettings, privySettings } from "./privy-client.js";
import { readPayload } from "./privy-payload.schema.js";
import type { KeyQuorum, PrivyId, PrivyPolicy, WalletRecord } from "./privy-records.js";
import {
  readKeyQuorum,
  readPolicy,
  refusalOf,
  readSignedTransaction,
  readWallet,
} from "./privy-wire.schema.js";

/** A call's options: every call stops when its signal aborts. */
export interface CallOptions {
  readonly signal: AbortSignal;
}

/** A key quorum of one P-256 key, which alone authorizes for it. */
export interface KeyQuorumRequest {
  /** DER SubjectPublicKeyInfo in base64, as the signer and the owner key code give it. */
  readonly publicKey: string;
  /** A label for Privy's dashboard, at most 50 characters. */
  readonly displayName: string;
}

/** A ceiling as a policy on Privy, owned by a key quorum, so only that quorum changes it. */
export interface PolicyRequest {
  readonly ceiling: Ceiling;
  readonly owner: PrivyId;
}

/** An Ethereum wallet: owned by one quorum, bound to the policy, with one signer bound to it too. */
export interface WalletRequest {
  readonly owner: PrivyId;
  readonly signer: PrivyId;
  readonly policy: PrivyId;
}

/** One `eth_signTransaction` request, and who authorizes it. */
export interface SignTransactionRequest {
  readonly wallet: PrivyId;
  readonly transaction: PrivyTransaction;
  /**
   * Signs the exact request the SDK built, or refuses it; a refusal stops the call before Privy
   * hears of it. The signal stops with the call.
   */
  readonly authorize: (
    request: PrivyRequest,
    signal: AbortSignal,
  ) => Promise<Result<string, "refused">>;
}

/**
 * Privy's API for one app, through Privy's official Node SDK: key quorums, policies, wallets and
 * signing. Every answer passes a schema; an answer of another shape throws
 * `custody.privy_malformed`.
 */
export interface PrivyApi {
  readonly appId: string;
  createKeyQuorum(request: KeyQuorumRequest, options: CallOptions): Promise<KeyQuorum>;
  keyQuorum(id: PrivyId, options: CallOptions): Promise<Result<KeyQuorum, "not_found">>;
  createPolicy(request: PolicyRequest, options: CallOptions): Promise<PrivyPolicy>;
  policy(id: PrivyId, options: CallOptions): Promise<Result<PrivyPolicy, "not_found">>;
  createWallet(request: WalletRequest, options: CallOptions): Promise<WalletRecord>;
  wallet(id: PrivyId, options: CallOptions): Promise<Result<WalletRecord, "not_found">>;
  /**
   * Asks Privy to sign one transaction, once, with a `privy-request-expiry` five minutes ahead,
   * so a captured signature stops working. Answers the signed transaction's bytes; `refused` when
   * the signer, Privy's policy or its authorization check refused; `unknown_wallet` when Privy
   * holds no such wallet.
   */
  signTransaction(
    request: SignTransactionRequest,
    options: CallOptions,
  ): Promise<Result<string, "refused" | "unknown_wallet">>;
}

const policyName = "binference ceiling";
const expiryMs = 5 * 60_000;

function valueOf(condition: PolicyCondition): string | string[] {
  return typeof condition.value === "string" ? condition.value : [...condition.value];
}

// The SDK's request types take mutable arrays; the ceiling's stay readonly.
function sdkCondition(condition: PolicyCondition) {
  return condition.field_source === "ethereum_calldata"
    ? {
        field_source: condition.field_source,
        field: condition.field,
        abi: condition.abi,
        operator: condition.operator,
        value: valueOf(condition),
      }
    : {
        field_source: condition.field_source,
        field: condition.field,
        operator: condition.operator,
        value: valueOf(condition),
      };
}

function sdkRule(rule: PolicyRule) {
  const { name, method, action } = rule;
  return { name, method, action, conditions: rule.conditions.map(sdkCondition) };
}

/** How one answer is read: by its reader, within the call's signal. */
interface Reading<A, T> {
  readonly reader: (answer: A) => T | undefined;
  readonly signal: AbortSignal;
}

async function found<A, T>(
  settings: PrivySettings,
  call: PrivyCall<A>,
  reading: Reading<A, T>,
): Promise<Result<T, "not_found">> {
  const outcome = await callPrivy(settings, call, reading.signal);
  if (!outcome.ok) {
    if (outcome.status === 404) {
      return err("not_found");
    }
    throw statusFault(call, outcome);
  }
  const value = reading.reader(outcome.value);
  if (value === undefined) {
    throw privyFault("custody.privy_malformed", call);
  }
  return ok(value);
}

async function made<A, T>(
  settings: PrivySettings,
  call: PrivyCall<A>,
  reading: Reading<A, T>,
): Promise<T> {
  const answer = await found(settings, call, reading);
  if (!answer.ok) {
    throw statusFault(call, { status: 404 });
  }
  return answer.value;
}

// Never leaves this file: a refusal of the signer stops the SDK before it sends anything.
const signerRefused = "custody.signer_refused";

async function authorized(
  payload: Uint8Array,
  request: SignTransactionRequest,
  signal: AbortSignal,
): Promise<string> {
  const privyRequest = readPayload(payload);
  if (privyRequest === undefined) {
    throw new BinferenceError({
      code: "custody.payload_unreadable",
      message: "The SDK asked to sign a payload that is no canonical Privy request.",
    });
  }
  const answer = await request.authorize(privyRequest, signal);
  if (!answer.ok) {
    throw new BinferenceError({ code: signerRefused, message: "The signer refused." });
  }
  return answer.value;
}

function signCall(settings: PrivySettings, request: SignTransactionRequest) {
  return {
    kind: "sign" as const,
    path: `/v1/wallets/${request.wallet}/rpc`,
    run: async (client: PrivyClient, signal: AbortSignal) =>
      client
        .wallets()
        .ethereum()
        .signTransaction(request.wallet, {
          params: { transaction: request.transaction },
          authorization_context: {
            sign_fns: [async (payload) => authorized(payload, request, signal)],
          },
          request_expiry: settings.clock.now() + expiryMs,
        }),
  };
}

async function signedOutcome(
  settings: PrivySettings,
  request: SignTransactionRequest,
  signal: AbortSignal,
): Promise<Awaited<ReturnType<typeof callPrivy>> | "refused"> {
  try {
    return await callPrivy(settings, signCall(settings, request), signal);
  } catch (error) {
    if (error instanceof BinferenceError && error.code === signerRefused) {
      return "refused";
    }
    throw error;
  }
}

async function signWith(
  settings: PrivySettings,
  request: SignTransactionRequest,
  signal: AbortSignal,
): Promise<Result<string, "refused" | "unknown_wallet">> {
  const call = signCall(settings, request);
  const outcome = await signedOutcome(settings, request, signal);
  if (outcome === "refused") {
    return err("refused");
  }
  if (outcome.ok) {
    const raw = readSignedTransaction(outcome.value);
    if (raw === undefined) {
      throw privyFault("custody.privy_malformed", call);
    }
    return ok(raw);
  }
  const refusal = refusalOf(outcome.code);
  if (refusal === "policy" || refusal === "authorization") {
    return err("refused");
  }
  if (refusal === "expired") {
    throw privyFault("custody.request_expired", call, outcome);
  }
  return outcome.status === 404
    ? err("unknown_wallet")
    : Promise.reject(statusFault(call, outcome));
}

function readCall<A>(path: string, run: (client: PrivyClient) => Promise<A>): PrivyCall<A> {
  return { kind: "read", path, run };
}

function quorumCreation({ publicKey, displayName }: KeyQuorumRequest) {
  return {
    kind: "write" as const,
    path: "/v1/key_quorums",
    run: async (client: PrivyClient) =>
      client.keyQuorums().create({
        public_keys: [publicKey],
        authorization_threshold: 1,
        display_name: displayName,
      }),
  };
}

function policyCreation({ ceiling, owner }: PolicyRequest) {
  return {
    kind: "write" as const,
    path: "/v1/policies",
    run: async (client: PrivyClient) =>
      client.policies().create({
        version: "1.0",
        name: policyName,
        chain_type: "ethereum",
        rules: ceiling.rules.map(sdkRule),
        owner_id: owner,
      }),
  };
}

function walletCreation({ owner, signer, policy }: WalletRequest) {
  return {
    kind: "write" as const,
    path: "/v1/wallets",
    run: async (client: PrivyClient) =>
      client.wallets().create({
        chain_type: "ethereum",
        owner_id: owner,
        policy_ids: [policy],
        additional_signers: [{ signer_id: signer, override_policy_ids: [policy] }],
      }),
  };
}

/** Creates a client of Privy's API for the owner's app, on Privy's official Node SDK. */
export function createPrivyApi(options: PrivyApiOptions): PrivyApi {
  const settings = privySettings(options);
  return {
    appId: settings.appId,
    createKeyQuorum: async (request, { signal }) =>
      made(settings, quorumCreation(request), { reader: readKeyQuorum, signal }),
    keyQuorum: async (id, { signal }) =>
      found(
        settings,
        readCall(`/v1/key_quorums/${id}`, async (client) => client.keyQuorums().get(id)),
        { reader: readKeyQuorum, signal },
      ),
    createPolicy: async (request, { signal }) =>
      made(settings, policyCreation(request), { reader: readPolicy, signal }),
    policy: async (id, { signal }) =>
      found(
        settings,
        readCall(`/v1/policies/${id}`, async (client) => client.policies().get(id)),
        { reader: readPolicy, signal },
      ),
    createWallet: async (request, { signal }) =>
      made(settings, walletCreation(request), { reader: readWallet, signal }),
    wallet: async (id, { signal }) =>
      found(
        settings,
        readCall(`/v1/wallets/${id}`, async (client) => client.wallets().get(id)),
        { reader: readWallet, signal },
      ),
    signTransaction: async (request, { signal }) => signWith(settings, request, signal),
  };
}
