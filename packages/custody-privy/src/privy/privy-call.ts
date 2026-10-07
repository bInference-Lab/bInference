import { BinferenceError, createDeadline, type ErrorCode } from "@binference/core";
import type { PrivyClient } from "@privy-io/node";
import { type PrivySettings, privyClientFor } from "./privy-client.js";
import { readStatus } from "./privy-wire.schema.js";

/**
 * How a call may be asked again: a read always; a write or a signing request never by this
 * package, as its outcome is unknown once it was sent.
 */
type CallKind = "read" | "write" | "sign";

/** One call through the SDK, named by its kind and its path for faults. */
export interface PrivyCall<T> {
  readonly kind: CallKind;
  /** The API path, such as `/v1/wallets`, which faults carry. */
  readonly path: string;
  readonly run: (client: PrivyClient, signal: AbortSignal) => Promise<T>;
}

/** An answer of Privy that is not a success: its status and its body as text. */
interface PrivyStatus {
  readonly status: number;
  readonly text: string;
}

/** What a call gives: the SDK's answer, or Privy's status when it was no success. */
export type PrivyOutcome<T> =
  | { readonly ok: true; readonly value: T }
  | ({ readonly ok: false } & PrivyStatus);

/** A fault of a Privy call. Details carry the path and the status, never a credential. */
export function privyFault(
  code: ErrorCode,
  call: Pick<PrivyCall<never>, "kind" | "path">,
  status?: number,
): BinferenceError {
  const retryable =
    code === "custody.privy_busy" || (call.kind === "read" && code !== "custody.privy_malformed");
  return new BinferenceError({
    code,
    message: `Privy's API failed a ${call.kind} call (${code}).`,
    retryable,
    details: status === undefined ? { path: call.path } : { path: call.path, status },
  });
}

/**
 * The fault for an answer that is not a success: Privy was busy, refused the app's credentials,
 * refused the request, or failed.
 */
export function statusFault(
  call: Pick<PrivyCall<never>, "kind" | "path">,
  status: number,
): BinferenceError {
  if (status === 429) {
    return privyFault("custody.privy_busy", call, status);
  }
  if (status === 401 || status === 403) {
    return privyFault("custody.privy_credentials", call, status);
  }
  return privyFault(status >= 500 ? "custody.privy_failed" : "custody.privy_refused", call, status);
}

function unanswered(call: Pick<PrivyCall<never>, "kind" | "path">, cause: Error): BinferenceError {
  return new BinferenceError({
    code: call.kind === "sign" ? "custody.sign_unknown" : "custody.privy_unreachable",
    message: "Privy's API gave no answer in time.",
    retryable: call.kind === "read",
    details: { path: call.path },
    cause,
  });
}

// Our own faults, such as the signer's timeout, pass through; an answer with a status is an
// outcome; anything else got no answer.
function outcomeOf<T>(error: Error, call: PrivyCall<T>): PrivyOutcome<T> {
  if (error instanceof BinferenceError) {
    throw error;
  }
  const answered = readStatus(error);
  if (answered !== undefined) {
    return { ok: false, ...answered };
  }
  throw unanswered(call, error);
}

/**
 * Runs one call through Privy's SDK within the timeout. The SDK client is made for the call, so
 * its requests stop with the call's signal; nothing retries. A call that gets no answer throws
 * `custody.privy_unreachable`, or `custody.sign_unknown` for a signing request, whose outcome is
 * then unknown. Rejects with the signal's reason once the signal aborts.
 */
export async function callPrivy<T>(
  settings: PrivySettings,
  call: PrivyCall<T>,
  signal: AbortSignal,
): Promise<PrivyOutcome<T>> {
  signal.throwIfAborted();
  const deadline = createDeadline({ clock: settings.clock, signal, timeoutMs: settings.timeoutMs });
  try {
    return {
      ok: true,
      value: await call.run(privyClientFor(settings, deadline.signal), deadline.signal),
    };
  } catch (error) {
    signal.throwIfAborted();
    return outcomeOf(error instanceof Error ? error : new Error(String(error)), call);
  } finally {
    deadline.clear();
  }
}
