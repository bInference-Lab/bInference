import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { Duplex } from "node:stream";
import { BinferenceError, type Clock, type Logger } from "@binference/core";
import type { WebhookAnswer, WebhookIntake } from "@binference/engine/orders";
import { bindListener, type ServerAddress } from "./bind-listener.js";
import { refuseUpgrade } from "./http-routes.js";
import { readLimitedBody } from "./limited-body.js";
import { resourceHeaders } from "./security-headers.js";

/** The largest alert body the listener reads (spec 1, section 2.2). */
export const maxWebhookBodyBytes = 16_384;

/** The webhook listener's bounds. */
export interface WebhookListenerLimits {
  /** Open connections; the listener closes each one past it at once. */
  readonly maxConnections: number;
  /** How long a request has to arrive whole, headers and body; Node answers 408 after it. */
  readonly requestTimeoutMs: number;
  /** How long one alert has to be recorded once it arrived; past it the answer is 503. */
  readonly takeTimeoutMs: number;
  /** How long `close` lets requests under way finish before it cuts their connections. */
  readonly closeGraceMs: number;
}

/** The bounds the engine runs the listener with. */
const defaultWebhookListenerLimits: WebhookListenerLimits = {
  maxConnections: 64,
  requestTimeoutMs: 10_000,
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

const answerHeaders = { ...resourceHeaders, "cache-control": "no-store", "content-length": "0" };

// The one route: `POST /hook/:ruleId/:secret`, read from the target as sent, never normalized,
// so no other path, dot segment or encoding reaches the intake.
const routePattern = /^\/hook\/([^/?#]+)\/([^/?#]+)(?:\?[^#]*)?$/;

function routeOf(request: IncomingMessage): { ruleId: string; secret: string } | undefined {
  if (request.method !== "POST") {
    return undefined;
  }
  const match = routePattern.exec(request.url ?? "");
  const [, ruleId, secret] = match ?? [];
  return ruleId === undefined || secret === undefined ? undefined : { ruleId, secret };
}

function answer(response: ServerResponse, status: keyof typeof statuses): void {
  const close = status === "too_large" ? { connection: "close" } : {};
  response.writeHead(statuses[status], { ...answerHeaders, ...close }).end();
}

interface Answering {
  readonly intake: Pick<WebhookIntake, "take">;
  readonly limits: WebhookListenerLimits;
  readonly lifetime: AbortSignal;
  readonly logger: Logger;
}

async function answerRequest(
  request: IncomingMessage,
  response: ServerResponse,
  answering: Answering,
): Promise<void> {
  const route = routeOf(request);
  if (route === undefined) {
    request.resume();
    answer(response, "not_found");
    return;
  }
  const body = await readLimitedBody(request, maxWebhookBodyBytes);
  if (body === undefined) {
    answer(response, "too_large");
    return;
  }
  const timeout = AbortSignal.timeout(answering.limits.takeTimeoutMs);
  const signal = AbortSignal.any([answering.lifetime, timeout]);
  try {
    answer(response, await answering.intake.take({ ...route, body }, { signal }));
  } catch (error) {
    // The path holds the rule's secret: a log line names the fault only.
    const errorCode = error instanceof BinferenceError ? error.code : "unexpected";
    answering.logger.error("webhook.take_failed", { errorCode });
    answer(response, "unavailable");
  }
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
 * Creates the webhook listener of spec 1, section 2.2 (decisions 0053, 0299 and 0333): a server of its
 * own on `127.0.0.1`, which a tunnel may publish, apart from the engine's port. It serves one
 * route, `POST /hook/:ruleId/:secret` with a body of at most 16 KiB, and nothing else: every other
 * method, path and WebSocket upgrade gets the same empty 404 an unknown rule gets. An alert is
 * answered only once the intake recorded it: 202 accepted, 404, 409 repeat, 429 over the rule's
 * rate, 413 over 16 KiB, 503 when it could not be recorded. Any body is an alert, JSON or not. No
 * answer carries a body, and no log line holds a path or a body. Nothing binds until `start`.
 */
export function createWebhookListener(options: WebhookListenerOptions): WebhookListener {
  const limits = { ...defaultWebhookListenerLimits, ...options.limits };
  const lifetime = new AbortController();
  const { intake, logger } = options;
  const answering: Answering = { intake, logger, limits, lifetime: lifetime.signal };
  const server = createServer(
    { requestTimeout: limits.requestTimeoutMs, headersTimeout: limits.requestTimeoutMs },
    (request, response) => void answerRequest(request, response, answering),
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
