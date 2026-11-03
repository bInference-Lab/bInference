import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { Duplex } from "node:stream";
import { BinferenceError, type Clock, isId, type Logger } from "@binference/core";
import type { WebhookAnswer, WebhookIntake } from "@binference/engine/orders";
import { bindListener, type ServerAddress } from "./bind-listener.js";
import { refuseUpgrade } from "./http-routes.js";
import { readLimitedBody } from "./limited-body.js";

/** The largest alert body the listener reads (spec 1, section 2.2). */
export const maxWebhookBodyBytes = 16_384;

/** The webhook listener's bounds. */
export interface WebhookListenerLimits {
  /**
   * Open connections; the listener closes each one past it at once. Each holds at most a 16 KiB
   * body, and every answer closes its connection.
   */
  readonly maxConnections: number;
  /**
   * How long a request has to arrive whole, headers and body; Node answers 408 and closes the
   * connection after it, at its next check.
   */
  readonly requestTimeoutMs: number;
  /** How often Node checks each connection against `requestTimeoutMs`. */
  readonly checkIntervalMs: number;
  /** How long one alert has to be recorded once it arrived; past it the answer is 503. */
  readonly takeTimeoutMs: number;
  /** How long `close` lets requests under way finish before it cuts their connections. */
  readonly closeGraceMs: number;
}

/** The bounds the engine runs the listener with. */
const defaultWebhookListenerLimits: WebhookListenerLimits = {
  maxConnections: 512,
  requestTimeoutMs: 5_000,
  checkIntervalMs: 1_000,
  takeTimeoutMs: 10_000,
  closeGraceMs: 5_000,
};

/** What the webhook listener is built from. */
export interface WebhookListenerOptions {
  /** The port on `127.0.0.1` (config `engine.webhookPort`); 0 picks a free one, as tests do. */
  readonly port: number;
  readonly intake: Pick<WebhookIntake, "take">;
  readonly clock: Clock;
  readonly logger: Logger;
  readonly limits?: Partial<WebhookListenerLimits>;
}

/** The listener inbound webhook alerts reach, apart from the engine's own port. */
export interface WebhookListener {
  /**
   * Binds `127.0.0.1` at the port and resolves with the address. Throws `server.listen_failed`
   * when the address is taken or the signal aborts first.
   */
  start(signal: AbortSignal): Promise<ServerAddress>;
  /**
   * Takes no new connection, lets requests under way finish for `closeGraceMs`, then cuts what is
   * left. A second call waits for the first.
   */
  close(): Promise<void>;
}

const statuses: Readonly<Record<WebhookAnswer | "too_large" | "unavailable", number>> = {
  accepted: 202,
  not_found: 404,
  repeat: 409,
  rate: 429,
  too_large: 413,
  unavailable: 503,
};

// Only what an empty answer needs, so the answers name no product: the console's headers would
// tell a scan of published hosts which of them run binference. Every answer closes its
// connection: a sender sends one alert per connection, and no idle connection holds a place.
const answerHeaders = {
  "cache-control": "no-store",
  "content-length": "0",
  "x-content-type-options": "nosniff",
  connection: "close",
};

// The one route: `POST /hook/:ruleId/:secret`, read from the target as sent, never normalized,
// so no other path, dot segment or encoding reaches the intake.
const routePattern = /^\/hook\/([^/?#]+)\/([^/?#]+)(?:\?[^#]*)?$/;

// A rule's secret is 32 bytes in base64url, without padding.
const secretPattern = /^[\w-]{43}$/;

/**
 * The route's rule id and secret, or `undefined` for any request the listener refuses from its
 * request line alone: another method or path, a rule id that is no `whr_` id, or a secret that is
 * not 43 base64url characters. Their forms are public, so refusing them early tells nothing.
 */
function routeOf(request: IncomingMessage): { ruleId: string; secret: string } | undefined {
  if (request.method !== "POST") {
    return undefined;
  }
  const match = routePattern.exec(request.url ?? "");
  const [, ruleId, secret] = match ?? [];
  if (ruleId === undefined || secret === undefined) {
    return undefined;
  }
  return isId("whr", ruleId) && secretPattern.test(secret) ? { ruleId, secret } : undefined;
}

function answer(response: ServerResponse, status: keyof typeof statuses): void {
  response.writeHead(statuses[status], answerHeaders).end();
}

function declaredBytes(request: IncomingMessage): number {
  return Number(request.headers["content-length"] ?? "0");
}

interface Answering {
  readonly intake: Pick<WebhookIntake, "take">;
  readonly limits: WebhookListenerLimits;
  readonly lifetime: AbortSignal;
  readonly logger: Logger;
}

// The path holds the rule's secret: a log line names the fault only.
function errorCodeOf(error: ErrorOptions["cause"]): string {
  return error instanceof BinferenceError ? error.code : "unexpected";
}

// Never rejects: a body cut off ends the connection with no answer, as its sender is gone.
async function answerRequest(
  request: IncomingMessage,
  response: ServerResponse,
  answering: Answering,
): Promise<void> {
  const route = routeOf(request);
  if (route === undefined) {
    answer(response, "not_found");
    return;
  }
  const body = await readLimitedBody(request, maxWebhookBodyBytes);
  if (!body.ok) {
    if (body.error === "cut") {
      response.destroy();
      return;
    }
    answer(response, "too_large");
    return;
  }
  const timeout = AbortSignal.timeout(answering.limits.takeTimeoutMs);
  const signal = AbortSignal.any([answering.lifetime, timeout]);
  try {
    answer(response, await answering.intake.take({ ...route, body: body.value }, { signal }));
  } catch (error) {
    answering.logger.error("webhook.take_failed", { errorCode: errorCodeOf(error) });
    answer(response, "unavailable");
  }
}

// A sender that asks before it sends its body (`Expect: 100-continue`) is told to send it only
// for the route with a body in bounds; anything else is answered at once and gets no `100`.
function serveContinue(request: IncomingMessage, response: ServerResponse, answering: Answering) {
  if (routeOf(request) === undefined) {
    answer(response, "not_found");
    return;
  }
  if (declaredBytes(request) > maxWebhookBodyBytes) {
    answer(response, "too_large");
    return;
  }
  response.writeContinue();
  serveRequest(request, response, answering);
}

// A fault left in answering a request ends its connection; it never reaches the process.
function serveRequest(request: IncomingMessage, response: ServerResponse, answering: Answering) {
  answerRequest(request, response, answering).catch((error: ErrorOptions["cause"]) => {
    answering.logger.error("webhook.answer_failed", { errorCode: errorCodeOf(error) });
    response.destroy();
  });
}

async function shutdown(server: Server, clock: Clock, graceMs: number): Promise<void> {
  if (!server.listening) {
    return;
  }
  const closed = new Promise<void>((resolve) => {
    server.close(() => resolve());
  });
  server.closeIdleConnections();
  const grace = new AbortController();
  const late = clock.sleep(graceMs, grace.signal).then(
    () => true,
    () => false,
  );
  const isLate = await Promise.race([closed.then(() => false), late]);
  grace.abort();
  if (isLate) {
    server.closeAllConnections();
    await closed;
  }
}

/**
 * Creates the webhook listener of spec 1, section 2.2 (decisions 0053, 0299 and 0333): a server of
 * its own on `127.0.0.1`, which a tunnel may publish, apart from the engine's port. It serves one
 * route, `POST /hook/:ruleId/:secret` with a body of at most 16 KiB, and nothing else: every other
 * method, path, malformed rule id or secret and WebSocket upgrade gets the same empty 404 an
 * unknown rule gets, from its request line alone. An alert is answered only once the intake
 * recorded it: 202 accepted, 404, 409 repeat, 429 over the rule's rate, 413 over 16 KiB, 503 when
 * it was not confirmed stored in time (it may still be). Any body is an alert, JSON or not. No
 * answer carries a body, every answer closes its connection, and no log line holds a path or a
 * body. A body that never arrives whole ends its connection, never the process. Nothing binds
 * until `start`.
 */
export function createWebhookListener(options: WebhookListenerOptions): WebhookListener {
  const limits = { ...defaultWebhookListenerLimits, ...options.limits };
  const lifetime = new AbortController();
  const { intake, logger } = options;
  const answering: Answering = { intake, logger, limits, lifetime: lifetime.signal };
  const server = createServer(
    {
      requestTimeout: limits.requestTimeoutMs,
      headersTimeout: limits.requestTimeoutMs,
      connectionsCheckingInterval: limits.checkIntervalMs,
      keepAliveTimeout: 1_000,
    },
    (request, response) => serveRequest(request, response, answering),
  );
  server.on("checkContinue", (request: IncomingMessage, response: ServerResponse) =>
    serveContinue(request, response, answering),
  );
  server.maxConnections = limits.maxConnections;
  server.on("upgrade", (_request: IncomingMessage, socket: Duplex) => refuseUpgrade(socket, 404));
  let closing: Promise<void> | undefined;
  return {
    async start(signal) {
      const address = await bindListener(server, { host: "127.0.0.1", port: options.port }, signal);
      options.logger.info("webhook.listening");
      return address;
    },
    async close() {
      closing ??= shutdown(server, options.clock, limits.closeGraceMs).finally(() =>
        lifetime.abort(),
      );
      return closing;
    },
  };
}
