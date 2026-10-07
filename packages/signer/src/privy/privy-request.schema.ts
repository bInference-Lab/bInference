import type { JsonValue } from "@binference/core";
import { z } from "zod";

/**
 * The `privy-` headers of a Privy API request, the only headers its authorization signature
 * covers. Authentication, `content-type` and trace headers are never part of it.
 */
export interface PrivyHeaders {
  readonly "privy-app-id": string;
  readonly "privy-idempotency-key"?: string;
  /** Unix milliseconds, as decimal text, by which Privy must handle the request. */
  readonly "privy-request-expiry"?: string;
}

/**
 * One Privy API request as its authorization signature covers it: the HTTP method, the full URL
 * without a trailing slash, the JSON body and the `privy-` headers. The engine sends Privy exactly
 * this request, so the signature holds.
 */
export interface PrivyRequest {
  readonly method: string;
  readonly url: string;
  readonly headers: PrivyHeaders;
  /** The JSON body; every number in it is a safe integer, so every reader sees the same text. */
  readonly body: JsonValue;
}

const headerText = z.string().regex(/^[\x21-\x7e]{1,256}$/);

/** Parses the `privy-` headers; no other header is allowed. */
const privyHeadersSchema: z.ZodType<PrivyHeaders, PrivyHeaders> = z.strictObject({
  "privy-app-id": headerText,
  "privy-idempotency-key": headerText.exactOptional(),
  "privy-request-expiry": z
    .string()
    .regex(/^[1-9]\d{0,15}$/)
    .exactOptional(),
});

const largestSafeInteger = 2 ** 53 - 1;

// A number past 2^53 or with a fraction reads differently in other languages, and Privy checks the
// signature over the body as it reads it.
function holdsOnlySafeIntegers(value: JsonValue): boolean {
  if (typeof value === "number") {
    return Math.trunc(value) === value && Math.abs(value) <= largestSafeInteger;
  }
  if (value === null || typeof value !== "object") {
    return true;
  }
  return Object.values(value).every(holdsOnlySafeIntegers);
}

/** Parses a {@link PrivyRequest}. */
export const privyRequestSchema: z.ZodType<PrivyRequest, PrivyRequest> = z.strictObject({
  method: z.string().regex(/^[A-Z]{1,16}$/),
  url: z.string().min(1).max(2048),
  headers: privyHeadersSchema,
  body: z.json().refine(holdsOnlySafeIntegers, {
    message: "Every number in a Privy body is a safe integer.",
  }),
});
