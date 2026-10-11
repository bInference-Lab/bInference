import { Buffer } from "node:buffer";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { DevicePairing } from "@binference/engine/access";
import type { ProtocolErrorCode } from "@binference/protocol";
import { decodePairBody } from "./pair-body.schema.js";
import { resourceHeaders } from "./security-headers.js";

/** The largest body `POST /pair` reads: the key and label fit in far less. */
export const maxPairBodyBytes = 4096;

/** What `POST /pair` checks and pairs through. */
export interface PairRouteContext {
  readonly pairing: DevicePairing;
  readonly isAllowedOrigin: (origin: string | undefined) => boolean;
  /** Aborts when the server stops. */
  readonly signal: AbortSignal;
}

const jsonHeaders = {
  ...resourceHeaders,
  "cache-control": "no-store",
  "content-type": "application/json",
};

const refusals = {
  "protocol.bad_args": { status: 400, message: "The body is not a pairing request." },
  "protocol.too_large": { status: 413, message: "The body is too large." },
  "auth.origin": { status: 403, message: "This origin may not pair a device." },
  "auth.invalid": { status: 401, message: "The pairing code is unknown or used." },
  "auth.expired": { status: 401, message: "The pairing code expired." },
} as const satisfies Partial<Record<ProtocolErrorCode, { status: number; message: string }>>;

type PairError = keyof typeof refusals;

function refuse(response: ServerResponse, code: PairError): void {
  const { status, message } = refusals[code];
  response.writeHead(status, jsonHeaders).end(JSON.stringify({ error: { code, message } }));
}

// The body as text, or `undefined` past the limit; the size is checked as the pieces arrive.
async function readBody(request: IncomingMessage): Promise<string | undefined> {
  const pieces: Buffer[] = [];
  let size = 0;
  for await (const piece of request) {
    const bytes = Buffer.isBuffer(piece) ? piece : Buffer.from(String(piece));
    size += bytes.byteLength;
    if (size > maxPairBodyBytes) {
      return undefined;
    }
    pieces.push(bytes);
  }
  return Buffer.concat(pieces).toString("utf8");
}

function declaredTooLarge(request: IncomingMessage): boolean {
  const declared = Number(request.headers["content-length"] ?? "0");
  return Number.isFinite(declared) && declared > maxPairBodyBytes;
}

async function pair(
  request: IncomingMessage,
  response: ServerResponse,
  context: PairRouteContext,
): Promise<void> {
  if (!context.isAllowedOrigin(request.headers.origin)) {
    refuse(response, "auth.origin");
    return;
  }
  const text = declaredTooLarge(request) ? undefined : await readBody(request);
  if (text === undefined) {
    response.setHeader("connection", "close");
    refuse(response, "protocol.too_large");
    return;
  }
  const body = decodePairBody(text);
  if (body === undefined) {
    refuse(response, "protocol.bad_args");
    return;
  }
  const paired = await context.pairing.pair(body, { signal: context.signal });
  if (!paired.ok) {
    refuse(response, paired.error);
    return;
  }
  response.writeHead(201, jsonHeaders).end(JSON.stringify({ deviceId: paired.value.device }));
}

/**
 * Answers `POST /pair` (protocol spec, section 4.2; decision 0155): an allowed `Origin`, a JSON
 * body of at most {@link maxPairBodyBytes}, then the pairing. It answers 201 `{ deviceId }`, or
 * a refusal `{ error: { code, message } }`: 403 `auth.origin`, 413 `protocol.too_large`, 400
 * `protocol.bad_args`, 401 `auth.invalid` or `auth.expired`. Another method is 405. A fault,
 * such as a store that fails, is 500 with no detail.
 */
export function answerPair(
  request: IncomingMessage,
  response: ServerResponse,
  context: PairRouteContext,
): void {
  if (request.method !== "POST") {
    response.writeHead(405, { ...jsonHeaders, allow: "POST" }).end();
    return;
  }
  pair(request, response, context).catch(() => {
    if (!response.headersSent) {
      response.writeHead(500, jsonHeaders);
    }
    response.end();
  });
}
