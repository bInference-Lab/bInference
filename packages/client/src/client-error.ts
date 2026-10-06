import { BinferenceError, type ErrorDetails } from "@binference/core";
import type { ByeFrame, ProtocolError } from "@binference/protocol";

/**
 * Every error code the client raises itself. The engine's codes arrive in `fail` and `bye` frames
 * and keep their own code. Surfaces map each code to an i18n message, as for protocol codes.
 */
export const clientErrorCodes = [
  "client.closed",
  "client.busy",
  "client.bad_reply",
  "client.disconnected",
  "client.cannot_prove",
] as const;

/** One error code the client raises itself, such as `client.disconnected`. */
export type ClientErrorCode = (typeof clientErrorCodes)[number];

/** What a client error is made of. */
export interface ClientErrorOptions {
  readonly code: ClientErrorCode;
  readonly message: string;
  readonly retryable?: boolean;
  readonly details?: ErrorDetails;
}

/** Builds a `BinferenceError` with one of the client's own codes. */
export function clientError(options: ClientErrorOptions): BinferenceError {
  return new BinferenceError(options);
}

/** Turns the error of a `fail` frame into a `BinferenceError` with the engine's code. */
export function errorFromFail(error: ProtocolError): BinferenceError {
  return new BinferenceError({
    code: error.code,
    message: error.message,
    retryable: error.retryable,
    ...(error.details === undefined ? {} : { details: error.details }),
  });
}

// The same credential or frames would fail the same way again, so these end the client.
const finalAreas: ReadonlySet<string> = new Set(["auth", "protocol"]);

/**
 * Turns a `bye` frame into a `BinferenceError` with its code. An `auth` or `protocol` code is
 * final; any other code, such as `engine.stopping`, lets the client reconnect.
 */
export function errorFromBye(bye: ByeFrame): BinferenceError {
  return new BinferenceError({
    code: bye.code,
    message: bye.message,
    retryable: !finalAreas.has(bye.code.slice(0, bye.code.indexOf("."))),
  });
}
