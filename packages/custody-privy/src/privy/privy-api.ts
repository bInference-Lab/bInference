import type { PrivyRequest } from "@binference/chain";
import { err, ok, type Result } from "@binference/core";
import type { PrivyClient } from "@privy-io/node";
import type { Ceiling } from "../ceiling/ceiling.js";
import type { PrivyTransaction } from "../signing/privy-transaction.js";
import type { OwnerAuthorize } from "../wallets/rule-plans.js";
import { callPrivy, type PrivyCall, privyFault, statusFault } from "./privy-call.js";
import { type PrivyApiOptions, type PrivySettings, privySettings } from "./privy-client.js";
import type { KeyQuorum, PrivyId, PrivyPolicy, WalletRecord } from "./privy-records.js";
import {
  readKeyQuorum,
  readPolicy,
  readWallet,
  readWalletList,
  type WalletListPage,
} from "./privy-wire.schema.js";
import {
  changeRule,
  type RuleAuthorization,
  type RuleChange,
  ruleChangeRequest,
  type RuleRefusal,
} from "./rule-update.js";
import { sdkRule } from "./sdk-rule.js";
import { signWith } from "./sign-transaction.js";
import {
  exportWallet,
  type SealedWalletKey,
  type WalletExportRefusal,
  type WalletExportRequest,
} from "./wallet-export.js";
import { type SignersChange, type SignersRefusal, setWalletSigners } from "./wallet-signers.js";

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

/** Which wallets a list asks for: those a key owns, a page at a time. */
export interface WalletListQuery {
  /** A P-256 public key, DER SubjectPublicKeyInfo in base64. */
  readonly authorizationKey: string;
  /** The cursor the page before gave; the first page has none. */
  readonly cursor?: string;
  /** How many wallets one page holds, 1 to 100. */
  readonly limit: number;
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
 * Privy's API for one app, through Privy's official Node SDK: key quorums, policies and their
 * rules, wallets and signing. Every answer passes a schema; an answer of another shape throws
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
   * One page of the app's Ethereum wallets whose owner is a key quorum that holds the public key
   * (Privy's `authorization_key` filter), from the cursor of an earlier page, at most `limit` of
   * them (1 to 100).
   */
  listWallets(query: WalletListQuery, options: CallOptions): Promise<WalletListPage>;
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
  /**
   * Writes one rule of a policy over, once, as the policy's owner authorizes: signing now, or with
   * a signature made earlier over {@link PrivyApi.ruleChangeRequest} of the same change.
   */
  changeRule(
    change: RuleChange,
    options: CallOptions & { readonly authorization: RuleAuthorization },
  ): Promise<Result<void, RuleRefusal>>;
  /** The request a rule change sends, for the owner to sign now and Privy to read later. */
  ruleChangeRequest(change: RuleChange): PrivyRequest;
  /**
   * Sets a wallet's added signers, once, in place of the ones it has, signed now by the wallet's
   * owner; answers the wallet as Privy reports it after the change.
   */
  setSigners(
    change: SignersChange,
    options: CallOptions & { readonly authorize: OwnerAuthorize },
  ): Promise<Result<WalletRecord, SignersRefusal>>;
  /**
   * Asks Privy, once, for a wallet's private key sealed with HPKE to the recipient key, signed now
   * by the wallet's owner; Privy never answers the key in the clear (decision 0131).
   */
  exportWallet(
    request: WalletExportRequest,
    options: CallOptions,
  ): Promise<Result<SealedWalletKey, WalletExportRefusal>>;
}

const policyName = "binference ceiling";

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

function readCall<A>(path: string, run: (client: PrivyClient) => Promise<A>): PrivyCall<A> {
  return { kind: "read", path, run };
}

function listCall(query: WalletListQuery) {
  return readCall("/v1/wallets", async (client) =>
    client.wallets().list({
      chain_type: "ethereum",
      authorization_key: query.authorizationKey,
      limit: query.limit,
      ...(query.cursor === undefined ? {} : { cursor: query.cursor }),
    }),
  );
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
    listWallets: async (query, { signal }) =>
      made(settings, listCall(query), { reader: readWalletList, signal }),
    wallet: async (id, { signal }) =>
      found(
        settings,
        readCall(`/v1/wallets/${id}`, async (client) => client.wallets().get(id)),
        { reader: readWallet, signal },
      ),
    signTransaction: async (request, { signal }) => signWith(settings, request, signal),
    changeRule: async (change, { authorization, signal }) =>
      changeRule(settings, change, { authorization, signal }),
    ruleChangeRequest: (change) => ruleChangeRequest(settings, change),
    exportWallet: async (request, { signal }) => exportWallet(settings, request, signal),
    setSigners: async (change, { authorize, signal }) =>
      setWalletSigners(settings, change, { authorize, signal }),
  };
}
