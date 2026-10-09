import {
  type AssetRef,
  assetRefParts,
  BinferenceError,
  err,
  type Http,
  type HttpResponse,
  ok,
  type TokenRiskSource,
} from "@binference/plugin-sdk";
import { type GoplusAnswer, readGoplusAnswer } from "./api/token-security.schema.js";
import { goplusReport } from "./goplus-findings.js";

/** What the GoPlus source is made from. */
export interface GoplusOptions {
  /** Reaches GoPlus's public API, which answers token security without a key. */
  readonly http: Http;
}

const origin = "https://api.gopluslabs.io";
const evmChainId = /^[1-9]\d{0,14}$/;
const success = 1;
// GoPlus's answers for a token it has no data on: data still syncing (2), an unsupported chain
// (2018, and 2022 seen live), an address that is no contract (2020, and 2007 seen live), and no
// contract information (2021).
const notCoveredCodes: ReadonlySet<number> = new Set([2, 2007, 2018, 2020, 2021, 2022]);
// Too many requests (4029), and a server error (5000): worth asking again later.
const busyCodes: ReadonlySet<number> = new Set([4029, 5000]);

function unavailable(status: number, code: number | undefined): BinferenceError {
  const isBusy = status === 429 || status >= 500 || busyCodes.has(code ?? 0);
  return new BinferenceError({
    code: code === 4029 || status === 429 ? "goplus.rate_limited" : "goplus.unavailable",
    message: `GoPlus gave no usable token security answer (HTTP ${String(status)}).`,
    retryable: isBusy,
    details: { status, answer: code ?? "none" },
  });
}

// The token's address as GoPlus keys its result: an ERC-20 token of an EIP-155 chain, in lowercase.
function tokenOf(
  asset: AssetRef,
): { readonly chainId: string; readonly address: string } | undefined {
  const { chain, assetNamespace, assetReference } = assetRefParts(asset);
  const [namespace, chainId = ""] = chain.split(":");
  return namespace === "eip155" && assetNamespace === "erc20" && evmChainId.test(chainId)
    ? { chainId, address: assetReference.toLowerCase() }
    : undefined;
}

function answerOf(response: HttpResponse): GoplusAnswer {
  const answer = response.status === 200 ? readGoplusAnswer(response.body) : undefined;
  if (answer === undefined) {
    throw unavailable(response.status, readGoplusAnswer(response.body)?.code);
  }
  return answer;
}

/**
 * Creates the `goplus` risk source over GoPlus's Token Security API
 * (`GET /api/v1/token_security/{chain_id}`), keyless: without an access token GoPlus answers one
 * token per call, which is all the source asks. GoPlus reports errors as codes in a 200 answer.
 * A token or chain GoPlus has no data on is `not_covered`; a rate limit is a retryable
 * `goplus.rate_limited` fault; a server error, an answer outside its documented shape or any other
 * code is a `goplus.unavailable` fault that names the code, never GoPlus's own text.
 */
export function createGoplusSource(options: GoplusOptions): TokenRiskSource {
  return {
    id: "goplus",
    async check(asset, { signal }) {
      signal.throwIfAborted();
      const token = tokenOf(asset);
      if (token === undefined) {
        return err("not_covered");
      }
      const query = new URLSearchParams({ contract_addresses: token.address });
      const url = `${origin}/api/v1/token_security/${token.chainId}?${query.toString()}`;
      const answer = answerOf(await options.http.request({ method: "GET", url, signal }));
      if (answer.code === success) {
        const found = answer.tokens?.[token.address];
        return found === undefined ? err("not_covered") : ok(goplusReport(found));
      }
      if (notCoveredCodes.has(answer.code)) {
        return err("not_covered");
      }
      throw unavailable(200, answer.code);
    },
  };
}
