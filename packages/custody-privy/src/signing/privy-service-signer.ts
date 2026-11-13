import type { SignerServiceRefusal, SignOutcome, Signer, SignRequest } from "@binference/chain";
import {
  BinferenceError,
  type Clock,
  createDeadline,
  createIdSource,
  err,
  type Http,
  type Id,
  type IdSource,
  ok,
  type Random,
  retry,
} from "@binference/core";
import { checkedSigned, isOnItsChain, readableTransaction } from "./checked-transaction.js";
import { accountOf, signingWallet, type WalletLookup } from "./privy-wallet.js";
import { readServiceAnswer } from "./service-answer.js";
import { type ServiceLease, serviceBodyOf, signsUntilMs } from "./service-request.js";
import type { ServiceDownReason, SignerServiceAnswer } from "./signer-service-wire.schema.js";

/** A step the signer service refused, with its reason, for `notice.signerRefused`. */
export interface ServiceRefusalNotice {
  readonly wallet: Id<"wal">;
  readonly intent: Id<"int">;
  readonly reason: SignerServiceRefusal;
}

/** What the `privy-service` adapter is built from. */
export interface PrivyServiceSignerOptions {
  /**
   * Reaches the signer service over mutual TLS (decision 0420), such as `createClientCertHttp` of
   * `@binference/platform/client-cert-http` with the worker's certificate, its key and the
   * service's authority, which the composition root hands in as data. It reads answers of up to
   * `signerServiceAnswerBytes`.
   */
  readonly http: Http;
  /** The service's origin, such as `https://signer.internal:8443`. */
  readonly origin: string;
  /** The lease the worker holds for the install whose engine signs. */
  readonly lease: ServiceLease;
  /** The Privy wallet behind an agent wallet, as the store keeps it; undefined for no wallet. */
  readonly walletOf: WalletLookup;
  readonly clock: Clock;
  readonly random: Random;
  /** Told of every refusal with its reason, which the port's `refused` does not carry. */
  readonly onRefusal: (refused: ServiceRefusalNotice) => void;
}

/** How long the service has to answer one request before it is asked again (spec 5, 8.7). */
const answerWithinMs = 30_000;

// Repeats after `down` or no answer: waits back off from half a second to 8 seconds, and none
// starts past the authorization's end.
const repeats = { attempts: 8, baseDelayMs: 500, maxDelayMs: 8_000 } as const;

/** One signing call's parts. */
interface Asking {
  readonly options: PrivyServiceSignerOptions;
  readonly request: SignRequest;
  readonly requestId: string;
  readonly body: string;
  readonly signal: AbortSignal;
}

// The service said it is down: the same request goes again.
function downNow(reason: ServiceDownReason): BinferenceError {
  return new BinferenceError({
    code: "custody.signer_down",
    message: "The signer service is down; the same request goes again.",
    retryable: true,
    details: { reason },
  });
}

// The service stayed down or silent for every repeat the authorization allowed.
function stayedDown(last: Readonly<Error>): BinferenceError {
  return new BinferenceError({
    code: "custody.signer_down",
    message:
      "The signer service stayed down or silent for every repeat the step's authorization allowed. Nothing was read as signed.",
    cause: last,
  });
}

// One request and its answer, or a retryable fault: no answer within 30 seconds, or `down`.
async function askOnce(asking: Asking, signal: AbortSignal): Promise<SignerServiceAnswer> {
  const { options } = asking;
  const deadline = createDeadline({ clock: options.clock, signal, timeoutMs: answerWithinMs });
  try {
    const response = await options.http.request({
      method: "POST",
      url: `${options.origin}/v1/sign`,
      headers: { "content-type": "application/json" },
      body: asking.body,
      signal: deadline.signal,
    });
    const answer = readServiceAnswer(response, asking.requestId);
    if (answer.outcome === "down") {
      throw downNow(answer.reason);
    }
    return answer;
  } finally {
    deadline.clear();
  }
}

// Asks with the same request id after `down` or no answer, while the authorization allows a
// signature; a fault that is no such answer goes up at once.
async function ask(asking: Asking): Promise<SignerServiceAnswer> {
  const { options, signal } = asking;
  const budgetMs = Math.max(0, signsUntilMs(asking.request) - options.clock.now());
  try {
    return await retry(async (attempt) => askOnce(asking, attempt.signal), {
      ...repeats,
      budgetMs,
      signal,
      clock: options.clock,
      random: options.random,
    });
  } catch (error) {
    signal.throwIfAborted();
    throw error instanceof BinferenceError && error.retryable ? stayedDown(error) : error;
  }
}

function leaseLost(lease: ServiceLease): BinferenceError {
  return new BinferenceError({
    code: "store.lease_lost",
    message: `The signer service says this worker no longer holds the lease of install ${lease.install} under fence ${String(lease.fence)}. Stop the install's engine and runtime now and write nothing more.`,
    details: { installId: lease.install, fence: lease.fence },
  });
}

function unread(request: SignRequest, why: string): BinferenceError {
  return new BinferenceError({
    code: "custody.service_answer_unread",
    message: `The signer service answered ${why}. Nothing is read as signed.`,
    details: { intent: request.intent },
  });
}

// The port's outcome of a signed answer: the exact transaction asked, with the hash the service
// named.
function signedOutcome(
  request: SignRequest,
  tx: { readonly chain: string; readonly raw: string; readonly hash: string },
): SignOutcome {
  if (tx.chain !== request.tx.chain) {
    throw unread(request, "a transaction of another chain");
  }
  const { signed, hash } = checkedSigned(request, tx.raw);
  if (hash.toLowerCase() !== tx.hash) {
    throw unread(request, "a hash that is not its transaction's");
  }
  return ok(signed);
}

// The port's outcome of a refusal: `over_sums` and `locked` keep their facts, and a rule's
// refusal is told with its reason.
function refusalOf(asking: Asking, answer: SignerServiceAnswer): SignOutcome {
  const { request, options } = asking;
  if (answer.outcome === "over_sums") {
    const { chain, asset, capBase, usedBase, askedBase, roomAtMs } = answer;
    if (chain !== request.tx.chain) {
      throw unread(request, "sums of another chain");
    }
    return { ...err("over_sums"), sums: { chain, asset, capBase, usedBase, askedBase, roomAtMs } };
  }
  if (answer.outcome === "locked") {
    return { ...err("locked"), lock: answer.reason };
  }
  if (answer.outcome !== "refused") {
    throw unread(request, answer.outcome);
  }
  options.onRefusal({ wallet: request.wallet, intent: request.intent, reason: answer.reason });
  return err(answer.reason === "unknown_wallet" ? "unknown_wallet" : "refused");
}

function outcomeOf(asking: Asking, answer: SignerServiceAnswer): SignOutcome {
  if (answer.outcome === "lease_lost") {
    throw leaseLost(asking.options.lease);
  }
  return answer.outcome === "signed"
    ? signedOutcome(asking.request, answer.tx)
    : refusalOf(asking, answer);
}

// The service's request id: a UUIDv7 from the clock and the random source, as every id is made.
function requestIdOf(ids: IdSource): string {
  return ids.next("sgn").slice("sgn_".length);
}

/**
 * Creates the `privy-service` custody adapter: a signer service holds the authorization key in a
 * KMS and signs each step after its own checks (spec 5, section 8). The adapter sends the service
 * the step by name under the worker's lease, never the transaction, its terms or its grant, and
 * maps each answer onto the port (decision 0425): `signed` is the transaction, checked to be the
 * exact one asked; `refused` is `refused`, or `unknown_wallet` for that reason, and `onRefusal`
 * hears the reason; `over_sums` and `locked` are the port's own refusals. `lease_lost` throws
 * `store.lease_lost`, never retried, so the worker stops the install. `down`, or no answer within
 * 30 seconds, sends the same request id again with backoff, never once the step's authorization
 * has ended, then throws `custody.signer_down`. An answer of any other shape throws
 * `custody.service_answer_unread` and is never read as signed.
 *
 * No composition root wires it yet: the hosted worker that holds install leases will.
 */
export function createPrivyServiceSigner(options: PrivyServiceSignerOptions): Signer {
  const ids = createIdSource({ clock: options.clock, random: options.random });
  return {
    account: async (wallet, chain, { signal }) =>
      accountOf(options.walletOf, { wallet, chain, signal }),
    async signTransaction(request, { signal }) {
      signal.throwIfAborted();
      const signing = signingWallet(options.walletOf, request);
      if (!signing.ok) {
        return signing;
      }
      const decoded = readableTransaction(request);
      if (!isOnItsChain(request, decoded)) {
        return err("refused");
      }
      const requestId = requestIdOf(ids);
      const body = serviceBodyOf(request, { lease: options.lease, requestId, decoded });
      const asking = { options, request, requestId, body, signal };
      return outcomeOf(asking, await ask(asking));
    },
  };
}
