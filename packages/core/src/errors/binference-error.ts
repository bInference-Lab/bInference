import { redactSecrets } from "./redact-secrets.js";

/** A dotted error code, `<area>.<reason>`, such as `rpc.timeout`. */
export type ErrorCode = `${string}.${string}`;

/** Values that help find a fault: ids and counts, never secrets or content. */
export type ErrorDetails = Readonly<Record<string, ErrorDetail>>;

/** One value of {@link ErrorDetails}. */
export type ErrorDetail = string | number | boolean;

const codePattern = /^[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)+$/;

/** Whether a text is a well-formed dotted error code. */
export function isErrorCode(text: string): text is ErrorCode {
  return codePattern.test(text);
}

/** What a {@link BinferenceError} is built from. `cause` is the error that led to it. */
export interface BinferenceErrorOptions extends Readonly<ErrorOptions> {
  readonly code: ErrorCode;
  /** English for developers; people see i18n text chosen by the code. */
  readonly message: string;
  /** Whether the same call may succeed later unchanged. */
  readonly retryable?: boolean;
  readonly details?: ErrorDetails;
}

function redactDetails(details: ErrorDetails): ErrorDetails {
  return Object.fromEntries(
    Object.entries(details).map(([key, value]: readonly [string, ErrorDetail]) => [
      key,
      typeof value === "string" ? redactSecrets(value) : value,
    ]),
  );
}

/**
 * The one error class: every fault throws it, with a dotted code. Expected outcomes return a
 * `Result` instead. String details are redacted when the error is made.
 */
export class BinferenceError extends Error {
  /** The dotted code that surfaces map to a message. */
  public readonly code: ErrorCode;
  /** Whether the same call may succeed later unchanged. */
  public readonly retryable: boolean;
  /** Redacted values that help find the fault. */
  public readonly details: ErrorDetails;

  public constructor(options: BinferenceErrorOptions) {
    super(options.message, "cause" in options ? { cause: options.cause } : undefined);
    this.name = "BinferenceError";
    this.code = options.code;
    this.retryable = options.retryable ?? false;
    this.details = redactDetails(options.details ?? {});
  }
}
