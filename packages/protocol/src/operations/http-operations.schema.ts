import { z } from "zod";
import { type ProtocolId, protocolIdSchema } from "../ids/id-prefixes.js";
import { type OperationTable, readFlags } from "./operation.schema.js";

/** The methods an API request sends (decision 0411). */
export type HttpRequestMethod = "GET" | "HEAD" | "POST" | "PUT" | "PATCH" | "DELETE";

/**
 * The bounds of an API request and its answer (decision 0411): what the agent sends, and what
 * of the answer fits a tool result.
 */
export const httpRequestLimits: {
  readonly urlChars: number;
  readonly headers: number;
  readonly headerNameChars: number;
  readonly headerValueChars: number;
  readonly bodyBytes: number;
  readonly timeoutSeconds: number;
  readonly defaultTimeoutSeconds: number;
  readonly answerHeaders: number;
  readonly answerHeaderChars: number;
  readonly answerBodyChars: number;
} = {
  urlChars: 2_048,
  headers: 32,
  headerNameChars: 100,
  headerValueChars: 8_192,
  bodyBytes: 256 * 1024,
  // The engine answers each call within 30 seconds; the rest is for the answer.
  timeoutSeconds: 25,
  defaultTimeoutSeconds: 20,
  answerHeaders: 16,
  answerHeaderChars: 500,
  answerBodyChars: 10_000,
};

/**
 * The request headers an API request never sets, lower-case: the HTTP library sets them, and
 * binference names itself in every request.
 */
export const refusedRequestHeaders: ReadonlySet<string> = new Set([
  "connection",
  "content-length",
  "expect",
  "host",
  "http2-settings",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "proxy-connection",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
  "user-agent",
]);

/** One header of a request or an answer. */
export interface HttpHeader {
  readonly name: string;
  readonly value: string;
}

/** The args of `http/request`: one HTTPS request the engine makes for the agent. */
export interface HttpRequestArgs {
  readonly agent: ProtocolId<"agent">;
  readonly method: HttpRequestMethod;
  readonly url: string;
  readonly headers?: readonly HttpHeader[];
  /** A text body, never with `GET` or `HEAD`. */
  readonly body?: string;
  /** 1 to 25 seconds; 20 when absent. */
  readonly timeoutSeconds?: number;
}

/** What the site answered, with every value the request carried replaced by its stand-in. */
export interface HttpAnswerView {
  readonly kind: "answer";
  readonly status: number;
  /** The answer's headers the agent may need, at most 16, names in lower case. */
  readonly headers: readonly HttpHeader[];
  readonly contentType?: string;
  /** The body's size in bytes, by `content-length` when the site gave one. */
  readonly bytes: number;
  /** The body as text, at most 10,000 characters; absent when it is empty or not text. */
  readonly body?: string;
  /** The body is not text, so only its type and size are answered. */
  readonly binary: boolean;
  /** The body went on past what `body` holds. */
  readonly cut: boolean;
  readonly durationMs: number;
}

/** Why an API request was refused before anything was sent. */
export type HttpRefusalReason =
  | "credential_unknown"
  | "credential_host"
  | "credential_outside"
  | "standin_place"
  | "standin_malformed"
  | "value_unfit";

/** A request refused before anything was sent, naming the credential and the host it was for. */
export interface HttpRefusalView {
  readonly kind: "refused";
  readonly reason: HttpRefusalReason;
  /** The credential's name; absent for a stand-in that names none. */
  readonly credential?: string;
  /** The URL's host, with its port when it names one. */
  readonly host: string;
}

/** The answer to `http/request`: the site's answer, or why nothing was sent. */
export type HttpRequestView = HttpAnswerView | HttpRefusalView;

/** The operation of the agent's API requests (decision 0411). */
export interface HttpOperationShapes {
  readonly "http/request": { readonly args: HttpRequestArgs; readonly result: HttpRequestView };
}

const encoder = new TextEncoder();
const methods = ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE"] as const;
// An HTTP token (RFC 9110, section 5.6.2).
const headerName = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;
// A field value Node sends: a tab, printable ASCII and the Latin-1 range, no line break.
const headerValue = /^[\t -~\u0080-ÿ]*$/;

/** Parses a header a request sends: a token name it may set, and a value with no line break. */
const requestHeaderSchema: z.ZodType<HttpHeader> = z.strictObject({
  name: z
    .string()
    .min(1)
    .max(httpRequestLimits.headerNameChars)
    .regex(headerName, { message: "A header name is an HTTP token, such as Authorization." })
    .refine((name) => !refusedRequestHeaders.has(name.toLowerCase()), {
      message: "binference sets this header itself.",
    }),
  value: z
    .string()
    .max(httpRequestLimits.headerValueChars)
    .regex(headerValue, { message: "A header value holds no line break or control character." }),
});

const isEachOnce = (headers: readonly HttpHeader[]): boolean =>
  new Set(headers.map(({ name }) => name.toLowerCase())).size === headers.length;

/** Parses the headers of a request: at most 32, each name once whatever its case. */
export const requestHeadersSchema: z.ZodType<readonly HttpHeader[]> = z
  .array(requestHeaderSchema)
  .max(httpRequestLimits.headers)
  .readonly()
  .refine(isEachOnce, { message: "Name each header once." });

/** Parses a request's body: text of at most 256 KiB. */
export const requestBodySchema: z.ZodType<string> = z
  .string()
  .refine((text) => encoder.encode(text).byteLength <= httpRequestLimits.bodyBytes, {
    message: "A body is at most 256 KiB.",
  });

// A request's time limit in seconds.
const requestTimeoutSchema = z.int().min(1).max(httpRequestLimits.timeoutSeconds);

/** Parses a request's method. */
export const requestMethodSchema: z.ZodType<HttpRequestMethod, string> = z.enum(methods);

/** Whether a method sends no body: `GET` and `HEAD`. */
export function isBodilessMethod(method: HttpRequestMethod): boolean {
  return method === "GET" || method === "HEAD";
}

const answerHeaderSchema: z.ZodType<HttpHeader> = z.object({
  name: z.string().min(1).max(httpRequestLimits.headerNameChars),
  value: z.string().max(httpRequestLimits.answerHeaderChars),
});

const httpRequestViewSchema: z.ZodType<HttpRequestView> = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("answer"),
    status: z.int().min(100).max(999),
    headers: z.array(answerHeaderSchema).max(httpRequestLimits.answerHeaders).readonly(),
    contentType: z.string().min(1).max(httpRequestLimits.answerHeaderChars).exactOptional(),
    bytes: z.int().min(0),
    body: z.string().min(1).max(httpRequestLimits.answerBodyChars).exactOptional(),
    binary: z.boolean(),
    cut: z.boolean(),
    durationMs: z.int().min(0),
  }),
  z.object({
    kind: z.literal("refused"),
    reason: z.enum([
      "credential_unknown",
      "credential_host",
      "credential_outside",
      "standin_place",
      "standin_malformed",
      "value_unfit",
    ]),
    credential: z.string().min(1).max(64).exactOptional(),
    host: z.string().min(1).max(httpRequestLimits.urlChars),
  }),
]);

/** The operation of the agent's API requests, by name. */
export const httpOperations: OperationTable<HttpOperationShapes> = {
  "http/request": {
    // No idempotency key: a kept answer would store what the site said, and what it carried.
    ...readFlags,
    name: "http/request",
    scope: "agent",
    args: z
      .strictObject({
        agent: protocolIdSchema("agent"),
        method: requestMethodSchema,
        url: z.string().min(1).max(httpRequestLimits.urlChars),
        headers: requestHeadersSchema.exactOptional(),
        body: requestBodySchema.exactOptional(),
        timeoutSeconds: requestTimeoutSchema.exactOptional(),
      })
      .refine((args) => args.body === undefined || !isBodilessMethod(args.method), {
        message: "GET and HEAD take no body.",
        path: ["body"],
      }),
    result: httpRequestViewSchema,
  },
};
