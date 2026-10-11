import {
  BinferenceError,
  type Clock,
  createSecret,
  type Http,
  type HttpRequest,
  type HttpResponse,
  type JsonValue,
  jsonValueSchema,
  type Random,
  type Secret,
} from "@binference/core";
import { answerAggregation, createAggregation } from "./fake-aggregations.js";
import { answer, failure, policyJson, quorumJson, walletJson } from "./fake-privy-answers.js";
import { createPolicy, createQuorum, createWallet } from "./fake-privy-creates.js";
import { answerExport, exportOf } from "./fake-privy-export.js";
import { parseJsonText } from "./fake-privy-request.schema.js";
import { answerSignTransaction } from "./fake-privy-rpc.js";
import {
  answerRuleAddition,
  answerRuleChange,
  answerRuleRemoval,
  ruleAdditionOf,
  ruleChangeOf,
} from "./fake-privy-rules.js";
import { answerSignersChange, signersChangeOf } from "./fake-privy-signers.js";
import type { FakePrivyState } from "./fake-privy-state.js";

/** Where the fake takes its ids, keys and time from. */
export interface FakePrivyOptions {
  readonly clock: Clock;
  readonly random: Random;
}

/** A Privy app for tests, served in memory, and the credentials that open it. */
export interface FakePrivy {
  /** Serves Privy's routes at {@link FakePrivy.origin}; any other URL is unreachable. */
  readonly http: Http;
  readonly origin: string;
  readonly appId: string;
  readonly appSecret: Secret;
}

const origin = "https://api.privy.io";
const appId = "fakeprivyapp000000000000";
const appSecretText = "fake-privy-app-secret";

function unreachable(): BinferenceError {
  return new BinferenceError({
    code: "http.unreachable",
    message: "The fake Privy serves only Privy's API origin.",
    retryable: true,
  });
}

function authenticated(request: HttpRequest): boolean {
  const basic = Buffer.from(`${appId}:${appSecretText}`).toString("base64");
  const headers = request.headers ?? {};
  return headers["authorization"] === `Basic ${basic}` && headers["privy-app-id"] === appId;
}

type Route = (state: FakePrivyState, id: string) => HttpResponse;

const reads: readonly (readonly [RegExp, Route])[] = [
  [/^\/v1\/key_quorums\/([^/]+)$/, (state, id) => found(state.quorums.get(id), quorumJson)],
  [/^\/v1\/policies\/([^/]+)$/, (state, id) => found(state.policies.get(id), policyJson)],
  [/^\/v1\/wallets\/([^/]+)$/, (state, id) => found(state.wallets.get(id), walletJson)],
  [/^\/v1\/aggregations\/([^/]+)$/, (state, id) => answerAggregation(state, "GET", id)],
];

const aggregationPath = /^\/v1\/aggregations\/([^/]+)$/;

function found<T>(item: T | undefined, json: (value: T) => JsonValue): HttpResponse {
  return item === undefined ? failure(404, "not_found", "Not found.") : answer(200, json(item));
}

// Whether a wallet's owner is a key quorum that holds the key, as Privy's `authorization_key`
// filter reads it; keys compare without the line breaks Privy's answers may carry.
function isOwnedBy(state: FakePrivyState, ownerId: string | null, key: string): boolean {
  const owner = ownerId === null ? undefined : state.quorums.get(ownerId);
  return owner?.publicKeys.some((held) => keyText(held) === keyText(key)) === true;
}

function keyText(value: string): string {
  return value.replaceAll(/\s/g, "");
}

// `GET /v1/wallets`: the app's wallets of one chain type, oldest first, those a key owns when the
// query names one, a page of at most `limit` (1 to 100) after the cursor's wallet, with the
// cursor of the next page while more follow.
function listWallets(state: FakePrivyState, query: URLSearchParams): HttpResponse {
  const limit = query.get("limit") ?? "100";
  const chainType = query.get("chain_type") ?? "ethereum";
  if (!/^(?:[1-9]\d?|100)$/.test(limit) || chainType !== "ethereum") {
    return failure(400, "invalid_data", "Invalid query.");
  }
  const key = query.get("authorization_key");
  const listed = [...state.wallets.values()].filter(
    (wallet) => key === null || isOwnedBy(state, wallet.ownerId, key),
  );
  const cursor = query.get("cursor");
  const start = cursor === null ? 0 : listed.findIndex((wallet) => wallet.id === cursor) + 1;
  const page = listed.filter((_, index) => index >= start && BigInt(index - start) < BigInt(limit));
  const last = page.at(-1);
  const hasMore = start + page.length < listed.length;
  return answer(200, {
    data: page.map(walletJson),
    next_cursor: hasMore && last !== undefined ? last.id : null,
  });
}

function answerRead(state: FakePrivyState, target: string): HttpResponse {
  const url = new URL(target, origin);
  if (url.pathname === "/v1/wallets") {
    return listWallets(state, url.searchParams);
  }
  const path = url.pathname;
  for (const [pattern, route] of reads) {
    const id = pattern.exec(path)?.[1];
    if (id !== undefined) {
      return route(state, id);
    }
  }
  return failure(404, "not_found", "No such route.");
}

// A `PATCH` of a policy's rule or of a wallet's signers; undefined for any other request.
function answerPatch(
  state: FakePrivyState,
  request: HttpRequest,
  target: { readonly path: string; readonly body: JsonValue },
): HttpResponse | undefined {
  const { path, body } = target;
  const rule = ruleChangeOf(request, path);
  if (rule !== undefined) {
    return answerRuleChange(state, request, { ...rule, body });
  }
  const wallet = signersChangeOf(request, path);
  return wallet === undefined ? undefined : answerSignersChange(state, request, { wallet, body });
}

// A `DELETE` of an aggregation or of a policy's rule; undefined for any other request.
function answerDelete(
  state: FakePrivyState,
  request: HttpRequest,
  path: string,
): HttpResponse | undefined {
  const aggregation = aggregationPath.exec(path)?.[1];
  if (aggregation !== undefined && request.method === "DELETE") {
    return answerAggregation(state, "DELETE", aggregation);
  }
  const rule = ruleChangeOf(request, path, "DELETE");
  return rule === undefined ? undefined : answerRuleRemoval(state, request, rule);
}

async function answerWrite(
  state: FakePrivyState,
  request: HttpRequest,
  path: string,
): Promise<HttpResponse> {
  const rpc = /^\/v1\/wallets\/([^/]+)\/rpc$/.exec(path)?.[1];
  if (rpc !== undefined) {
    return answerSignTransaction(state, request, rpc);
  }
  const deleted = answerDelete(state, request, path);
  if (deleted !== undefined) {
    return deleted;
  }
  const body = jsonValueSchema.safeParse(parseJsonText(request.body ?? ""));
  if (!body.success) {
    return failure(400, "invalid_data", "The request body is not JSON.");
  }
  const target = { path, body: body.data };
  return answerChange(state, request, target) ?? answerCreate(state, target);
}

// A `PATCH`, a new rule or an export; undefined for any other request.
function answerChange(
  state: FakePrivyState,
  request: HttpRequest,
  target: { readonly path: string; readonly body: JsonValue },
): HttpResponse | Promise<HttpResponse> | undefined {
  const patched = answerPatch(state, request, target);
  if (patched !== undefined) {
    return patched;
  }
  const addition = ruleAdditionOf(request, target.path);
  if (addition !== undefined) {
    return answerRuleAddition(state, request, { policy: addition, body: target.body });
  }
  const exported = exportOf(request, target.path);
  return exported === undefined
    ? undefined
    : answerExport(state, request, { wallet: exported, body: target.body });
}

function answerCreate(
  state: FakePrivyState,
  { path, body }: { readonly path: string; readonly body: JsonValue },
): HttpResponse {
  switch (path) {
    case "/v1/key_quorums":
      return createQuorum(state, body);
    case "/v1/policies":
      return createPolicy(state, body);
    case "/v1/wallets":
      return createWallet(state, body);
    case "/v1/aggregations":
      return createAggregation(state, body);
    default:
      return failure(404, "not_found", "No such route.");
  }
}

/**
 * Creates a fake Privy app that enforces what binference relies on: Basic auth with the app id
 * and secret; request bodies as strict as Privy's OpenAPI document; P-256 authorization signatures
 * over RFC 8785 payloads from the wallet's owner or an added signer; the request expiry; the
 * policy that binds the signing party, with Privy's semantics; a change of a policy rule, signed
 * by the policy's owner; a change of a wallet's added signers, signed by its owner; a wallet's
 * export, signed by its owner and sealed with HPKE; and aggregations, at most 10, whose rolling
 * sums the policies' reference conditions read and each signed request adds to. Wallet
 * keys are secp256k1 keys the fake holds and signs with. It supports Ethereum wallets and
 * `eth_signTransaction` only.
 */
export function createFakePrivy(options: FakePrivyOptions): FakePrivy {
  const state: FakePrivyState = {
    appId,
    origin,
    clock: options.clock,
    random: options.random,
    quorums: new Map(),
    policies: new Map(),
    wallets: new Map(),
    aggregations: new Map(),
    additions: new Map(),
  };
  return {
    origin,
    appId,
    appSecret: createSecret(appSecretText),
    http: {
      async request(request) {
        request.signal.throwIfAborted();
        if (!request.url.startsWith(`${origin}/`)) {
          throw unreachable();
        }
        if (!authenticated(request)) {
          return failure(401, "invalid_auth", "Invalid app ID or app secret.");
        }
        const path = request.url.slice(origin.length);
        return request.method === "GET"
          ? answerRead(state, path)
          : answerWrite(state, request, path);
      },
    },
  };
}
