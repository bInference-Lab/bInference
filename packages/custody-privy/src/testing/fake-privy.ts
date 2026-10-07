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
import { answer, failure, policyJson, quorumJson, walletJson } from "./fake-privy-answers.js";
import { createPolicy, createQuorum, createWallet } from "./fake-privy-creates.js";
import { parseJsonText } from "./fake-privy-request.schema.js";
import { answerSignTransaction } from "./fake-privy-rpc.js";
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
];

function found<T>(item: T | undefined, json: (value: T) => JsonValue): HttpResponse {
  return item === undefined ? failure(404, "not_found", "Not found.") : answer(200, json(item));
}

// `GET /v1/wallets`: the app's wallets of one chain type, oldest first, at most `limit` (1 to
// 100), on one page: the fake never pages.
function listWallets(state: FakePrivyState, query: URLSearchParams): HttpResponse {
  const limit = query.get("limit") ?? "100";
  const chainType = query.get("chain_type") ?? "ethereum";
  if (!/^(?:[1-9]\d?|100)$/.test(limit) || chainType !== "ethereum") {
    return failure(400, "invalid_data", "Invalid query.");
  }
  const page = [...state.wallets.values()]
    .filter((_, index) => BigInt(index) < BigInt(limit))
    .map(walletJson);
  return answer(200, { data: page, next_cursor: null });
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

async function answerWrite(
  state: FakePrivyState,
  request: HttpRequest,
  path: string,
): Promise<HttpResponse> {
  const rpc = /^\/v1\/wallets\/([^/]+)\/rpc$/.exec(path)?.[1];
  if (rpc !== undefined) {
    return answerSignTransaction(state, request, rpc);
  }
  const body = jsonValueSchema.safeParse(parseJsonText(request.body ?? ""));
  if (!body.success) {
    return failure(400, "invalid_data", "The request body is not JSON.");
  }
  switch (path) {
    case "/v1/key_quorums":
      return createQuorum(state, body.data);
    case "/v1/policies":
      return createPolicy(state, body.data);
    case "/v1/wallets":
      return createWallet(state, body.data);
    default:
      return failure(404, "not_found", "No such route.");
  }
}

/**
 * Creates a fake Privy app that enforces what binference relies on: Basic auth with the app id
 * and secret; request bodies as strict as Privy's OpenAPI document; P-256 authorization signatures
 * over RFC 8785 payloads from the wallet's owner or an added signer; the request expiry; and the
 * policy that binds the signing party, with Privy's semantics. Wallet keys are secp256k1 keys the
 * fake holds and signs with. It supports Ethereum wallets and `eth_signTransaction` only.
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
