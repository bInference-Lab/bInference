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
import { readHoneypotAnswer } from "./api/is-honeypot.schema.js";
import { honeypotReport } from "./honeypot-findings.js";

/** What the honeypot.is source is made from. */
export interface HoneypotOptions {
  /** Reaches honeypot.is's public API, which takes no key. */
  readonly http: Http;
}

const origin = "https://api.honeypot.is";
// The chains honeypot.is's docs list: Ethereum, BNB Smart Chain and Base.
const chainIds: ReadonlySet<string> = new Set(["eip155:1", "eip155:56", "eip155:8453"]);

function failed(response: HttpResponse): BinferenceError {
  const { status } = response;
  const isBusy = status === 429 || status >= 500;
  return new BinferenceError({
    code: status === 429 ? "honeypot.rate_limited" : "honeypot.unavailable",
    message: `honeypot.is gave no usable answer (HTTP ${String(status)}).`,
    retryable: isBusy,
    details: { status, resetAt: response.headers["x-ratelimit-reset"] ?? "none" },
  });
}

// An ERC-20 token of a chain honeypot.is serves: its address, and the chain's EIP-155 id.
function tokenOf(asset: AssetRef): URLSearchParams | undefined {
  const { chain, assetNamespace, assetReference } = assetRefParts(asset);
  const chainId = chain.split(":")[1] ?? "";
  return chainIds.has(chain) && assetNamespace === "erc20"
    ? new URLSearchParams({ address: assetReference, chainID: chainId })
    : undefined;
}

/**
 * Creates the `honeypot` risk source over honeypot.is's `GET /v2/IsHoneypot`, keyless as its docs
 * ask for now. It names the chain, so honeypot.is never picks one on its own. A token of a chain
 * its docs do not list, and an answer of HTTP 404 (no token or no pair it can test), are
 * `not_covered`. HTTP 429 is a retryable `honeypot.rate_limited` fault with the time the limit
 * resets; HTTP 5xx a retryable `honeypot.unavailable`; any other status, or an answer outside
 * its documented shape, a `honeypot.unavailable` fault. honeypot.is's error text is never shown.
 */
export function createHoneypotSource(options: HoneypotOptions): TokenRiskSource {
  return {
    id: "honeypot",
    async check(asset, { signal }) {
      signal.throwIfAborted();
      const query = tokenOf(asset);
      if (query === undefined) {
        return err("not_covered");
      }
      const url = `${origin}/v2/IsHoneypot?${query.toString()}`;
      const response = await options.http.request({ method: "GET", url, signal });
      if (response.status === 404) {
        return err("not_covered");
      }
      const answer = response.status === 200 ? readHoneypotAnswer(response.body) : undefined;
      if (answer === undefined) {
        throw failed(response);
      }
      return ok(honeypotReport(answer));
    },
  };
}
