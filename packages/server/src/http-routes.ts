import type { IncomingMessage, ServerResponse } from "node:http";
import type { Duplex } from "node:stream";
import type { Logger } from "@binference/core";
import type { DevicePairing } from "@binference/engine/access";
import type { UploadShelf } from "@binference/engine/chat";
import type { EngineState } from "@binference/protocol";
import type { AuthFailures } from "./auth-failures.js";
import { answerConsole, type ConsoleFiles } from "./console-route.js";
import type { LockoutAlerts } from "./lockout-alerts.js";
import type { OriginRules, RequestNames } from "./origin-check.js";
import { answerPair } from "./pair-route.js";
import { resourceHeaders } from "./security-headers.js";
import { isTelegramCredential } from "./sign-in.js";
import { answerUpload, type UploadRouteContext, uploadPath } from "./upload-route.js";

/** The path of a request, `/` when it has none. */
export function pathOf(request: IncomingMessage): string {
  const target = request.url ?? "/";
  return URL.canParse(target, "http://localhost")
    ? new URL(target, "http://localhost").pathname
    : "/";
}

const plain = { ...resourceHeaders, "cache-control": "no-store" };

function headerOf(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

// The names a request carries of where it was sent: by the browser, and by a proxy before us.
function namesOf(request: IncomingMessage): RequestNames {
  const { host, origin } = request.headers;
  const forwardedHost = headerOf(request.headers["x-forwarded-host"]);
  return {
    ...(host === undefined ? {} : { host }),
    ...(origin === undefined ? {} : { origin }),
    ...(forwardedHost === undefined ? {} : { forwardedHost }),
  };
}

const loopbackAddresses = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);

/**
 * Where a request came from, to count its failed sign-ins and pairings: its peer address, or, for
 * a request a proxy on this machine passed on, the first address of its `X-Forwarded-For`. The
 * source only counts failures; it is never trusted to let anything in.
 */
export function sourceOf(request: IncomingMessage): string {
  const peer = request.socket.remoteAddress ?? "unknown";
  const forwarded = headerOf(request.headers["x-forwarded-for"])?.split(",")[0]?.trim();
  return loopbackAddresses.has(peer) && forwarded !== undefined && forwarded !== ""
    ? `forwarded:${forwarded}`
    : peer;
}

/** What the plain HTTP routes answer from. */
export interface HttpRoutesContext {
  readonly state: () => EngineState;
  /** Which origins may pair, and whether a request came through the public address. */
  readonly origins: () => OriginRules;
  /** The failed pairings, per source. */
  readonly failures: AuthFailures;
  /** Tells the owner of the lockouts those failures set. */
  readonly alerts: LockoutAlerts;
  readonly logger: Logger;
  /** Pairs console devices at `POST /pair`; without it the path is 404. */
  readonly pairing?: DevicePairing;
  /** The console's built files; without them `/` and `/mini` are 404. */
  readonly consoleFiles?: ConsoleFiles;
  /** Takes the owner's images at `POST /upload/:ticket`; without it the path is 404. */
  readonly uploads?: Pick<UploadShelf, "receive">;
  /** Whether a connection signed in with this credential is open now. */
  readonly isSignedIn: (credential: string) => boolean;
  /** Aborts when the server stops. */
  readonly signal: AbortSignal;
}

function answerHealth(
  request: IncomingMessage,
  response: ServerResponse,
  state: () => EngineState,
): void {
  if (request.method !== "GET") {
    response.writeHead(405, { ...plain, allow: "GET" }).end();
    return;
  }
  const current = state();
  response
    .writeHead(current === "starting" ? 503 : 200, { ...plain, "content-type": "application/json" })
    .end(JSON.stringify({ state: current }));
}

interface WriteContext extends HttpRoutesContext {
  readonly path: string;
  readonly rules: OriginRules;
  /** The request came through the public address. */
  readonly isPublished: boolean;
}

// Who may upload. On this machine: no browser, or one from an origin that may pair. Through the
// public address (decision 0229): only the Mini App's page, on a ticket a Mini App connection
// asked for while that connection stays signed in.
function uploadRules(
  context: WriteContext,
): Pick<UploadRouteContext, "isAllowedOrigin" | "admits"> {
  const { rules, isSignedIn } = context;
  if (!context.isPublished) {
    return { isAllowedOrigin: (origin) => origin === undefined || rules.isPairingOrigin(origin) };
  }
  return {
    isAllowedOrigin: rules.isPublicOrigin,
    admits: (holder) => isTelegramCredential(holder) && isSignedIn(holder),
  };
}

// The routes that write, `POST /upload/:ticket` and `POST /pair`, when the server serves them:
// answers whether one took the request.
function answerWrite(
  request: IncomingMessage,
  response: ServerResponse,
  context: WriteContext,
): boolean {
  const { pairing, uploads, signal, path, rules: origins } = context;
  if (path.startsWith(uploadPath) && uploads !== undefined) {
    answerUpload(request, response, { uploads, path, ...uploadRules(context) });
    return true;
  }
  if (path !== "/pair" || pairing === undefined) {
    return false;
  }
  const { failures, alerts, logger } = context;
  const guard = { failures, alerts, logger, source: sourceOf(request) };
  answerPair(request, response, {
    pairing,
    isAllowedOrigin: origins.isPairingOrigin,
    signal,
    guard,
  });
  return true;
}

/**
 * Answers a plain HTTP request. `GET /health` answers `200 {"state":"ready"}`, `200
 * {"state":"locked"}` for an engine that serves calls but signs nothing yet, or
 * `503 {"state":"starting"}`. `POST /pair` pairs a console device, `POST /upload/:ticket` takes
 * the owner's image (`answerUpload`), and every other `GET` the console's files serve
 * (`answerConsole`). A wrong method on `/health` or `/pair` is 405, and
 * anything else 404. Through the public address, `/health` and `/pair` are 404, and an upload
 * needs the public origin and a Mini App's ticket (decision 0229).
 */
export function answerRequest(
  request: IncomingMessage,
  response: ServerResponse,
  context: HttpRoutesContext,
): void {
  const path = pathOf(request);
  const origins = context.origins();
  const isPublished = origins.isPublished(namesOf(request));
  // Pairing and health stay on this machine: through the public address they do not exist.
  if ((path === "/health" || path === "/pair") && isPublished) {
    response.writeHead(404, plain).end();
    return;
  }
  if (path === "/health") {
    answerHealth(request, response, context.state);
    return;
  }
  if (answerWrite(request, response, { ...context, path, rules: origins, isPublished })) {
    return;
  }
  const { consoleFiles } = context;
  const isConsole =
    consoleFiles !== undefined &&
    path !== "/ws" &&
    answerConsole(request, response, { files: consoleFiles, path });
  if (!isConsole) {
    response.writeHead(404, plain).end();
  }
}

const statusLines = { 404: "404 Not Found", 503: "503 Service Unavailable" } as const;

/**
 * Answers an upgrade the server refuses with a bare HTTP status, then closes the socket: 404 for a
 * path other than `/ws`, 503 while the server is full or closing.
 */
export function refuseUpgrade(socket: Duplex, status: keyof typeof statusLines): void {
  socket.on("error", () => socket.destroy());
  socket.once("finish", () => socket.destroy());
  socket.end(`HTTP/1.1 ${statusLines[status]}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
}
