import { Buffer } from "node:buffer";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Logger } from "@binference/core";
import type { DevicePairing } from "@binference/engine/access";
import type { ProtocolErrorCode } from "@binference/protocol";
import type { AuthFailures } from "./auth-failures.js";
import { type LockoutAlerts, sourceKey } from "./lockout-alerts.js";
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
  /** Counts each refused code per source, and refuses a source that failed too often lately. */
  readonly guard: {
    readonly failures: AuthFailures;
    readonly alerts: LockoutAlerts;
    readonly logger: Logger;
    readonly source: string;
  };
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
  "protocol.busy": { status: 429, message: "Too many failed pairings; try again later." },
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
  const { failures, alerts, logger } = context.guard;
  const source = sourceKey(context.guard.source);
  if (failures.isLocked([source.key])) {
    logger.warn("server.pair_locked_out");
    refuse(response, "protocol.busy");
    return;
  }
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
    // A wrong or spent code counts against its source; the code itself is never logged.
    logger.warn("server.pair_failed", { errorCode: paired.error });
    alerts.locked([source], failures.fail([source.key]));
    refuse(response, paired.error);
    return;
  }
  response.writeHead(201, jsonHeaders).end(JSON.stringify({ deviceId: paired.value.device }));
}

/**
 * Answers `POST /pair` (protocol spec, section 4.2; decision 0155): an allowed `Origin`, a JSON
 * body of at most {@link maxPairBodyBytes}, then the pairing. It answers 201 `{ deviceId }`, or
 * a refusal `{ error: { code, message } }`: 403 `auth.origin`, 413 `protocol.too_large`, 400
 * `protocol.bad_args`, 401 `auth.invalid` or `auth.expired`, and 429 `protocol.busy` for a source
 * whose codes failed too often lately. Another method is 405. A fault, such as a store that fails,
 * is 500 with no detail.
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
