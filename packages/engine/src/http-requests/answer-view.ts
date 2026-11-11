import type { HttpResponse } from "@binference/core";
import { type HttpAnswerView, type HttpHeader, httpRequestLimits } from "@binference/protocol";
import { z } from "zod";
import { masked } from "./credential-stand-ins.js";

/** What an answer is read with: whether the request was a `HEAD`, its values, and its time. */
export interface AnswerContext {
  readonly head: boolean;
  readonly values: ReadonlyMap<string, string>;
  readonly durationMs: number;
}

const kept: ReadonlySet<string> = new Set([
  "content-type",
  "content-length",
  "location",
  "retry-after",
]);
// `ratelimit`, `ratelimit-policy` and the `x-ratelimit-*` and `x-rate-limit-*` headers.
const rateLimit = /^(?:x-)?rate-?limit(?:-|$)/u;

const textTypes: ReadonlySet<string> = new Set([
  "application/json",
  "application/xml",
  "application/javascript",
  "application/x-www-form-urlencoded",
  "application/x-ndjson",
  "application/yaml",
  "application/graphql-response+json",
]);

const encoder = new TextEncoder();

// Cuts a text to `max` characters, never between the two halves of one character.
function cut(text: string, max: number): string {
  if (text.length <= max) {
    return text;
  }
  const end = /[\uD800-\uDBFF]/u.test(text.charAt(max - 1)) ? max - 1 : max;
  return text.slice(0, end);
}

function headersOf(response: HttpResponse, values: ReadonlyMap<string, string>): HttpHeader[] {
  const shown: HttpHeader[] = [];
  for (const [name, value] of Object.entries(response.headers)) {
    if (
      (kept.has(name) || rateLimit.test(name)) &&
      shown.length < httpRequestLimits.answerHeaders
    ) {
      shown.push({ name, value: cut(masked(value, values), httpRequestLimits.answerHeaderChars) });
    }
  }
  return shown;
}

// The media type of `content-type`, in lower case, its parameters left out.
function mediaTypeOf(contentType: string | undefined): string | undefined {
  const type = contentType?.split(";")[0]?.trim().toLowerCase();
  return type === undefined || type === "" ? undefined : type;
}

// A NUL, or the character a decoder puts for bytes that are no UTF-8.
const nul = String.fromCodePoint(0);
const replacement = String.fromCodePoint(0xfffd);

// Whether a body is text: by its media type, or by its characters when the site named none.
function isText(type: string | undefined, body: string): boolean {
  if (type === undefined) {
    return !body.includes(nul) && !body.includes(replacement);
  }
  return type.startsWith("text/") || textTypes.has(type) || /\+(?:json|xml)$/u.test(type);
}

const lengthSchema = z
  .string()
  .regex(/^\d{1,15}$/u)
  .pipe(z.coerce.number<string>())
  .pipe(z.int());

function bytesOf(response: HttpResponse): number {
  const length = lengthSchema.safeParse(response.headers["content-length"]);
  return length.success ? length.data : encoder.encode(response.body).byteLength;
}

/**
 * The site's answer as the agent reads it (decision 0411): its status; its content type, length,
 * location, retry time and rate-limit headers, at most 16, each value at most 500 characters; and
 * its body as text, at most 10,000 characters, or by its type and size alone when it is not text.
 * Each value the request carried, as it is and percent-encoded, is replaced by its stand-in
 * before anything is cut.
 */
export function answerViewOf(response: HttpResponse, context: AnswerContext): HttpAnswerView {
  const contentTypeHeader = response.headers["content-type"];
  const type = mediaTypeOf(contentTypeHeader);
  const text = context.head || response.body === "" ? "" : response.body;
  const binary = text !== "" && !isText(type, text);
  const body = binary ? "" : masked(text, context.values);
  const max = httpRequestLimits.answerBodyChars;
  return {
    kind: "answer",
    status: response.status,
    headers: headersOf(response, context.values),
    ...(contentTypeHeader === undefined || contentTypeHeader === ""
      ? {}
      : { contentType: cut(masked(contentTypeHeader, context.values), max) }),
    bytes: bytesOf(response),
    ...(body === "" ? {} : { body: cut(body, max) }),
    binary,
    cut: body.length > max,
    durationMs: context.durationMs,
  };
}
