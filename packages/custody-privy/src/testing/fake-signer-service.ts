import { once } from "node:events";
// oxlint-disable-next-line eslint/no-restricted-imports -- the types of the fake's own loopback server
import type { IncomingMessage, ServerResponse } from "node:http";
// oxlint-disable-next-line eslint/no-restricted-imports -- the fake signer service listens on the loopback for tests: no outbound request
import { createServer, type Server } from "node:https";
import { TLSSocket } from "node:tls";
import { z } from "zod";
import {
  decodeServiceRequest,
  type ServiceOutcome,
  type SignerServiceAnswer,
  signerServiceAnswerSchema,
  type SignerServiceRequest,
  signerServiceRequestBytes,
} from "../signing/signer-service-wire.schema.js";
import type { FakeAfterChecks, FakeSignerBook } from "./fake-signer-book.js";

/** What the fake does with the next request it takes, in place of answering it at once. */
export type FakeServiceEvent =
  /**
   * Answers this outcome under the request's id with its status, 503 for `down` and 200 for the
   * rest unless named, and keeps nothing: the book never sees the request.
   */
  | { readonly kind: "answer"; readonly outcome: ServiceOutcome; readonly status?: number }
  /** Answers and keeps the answer, but never sends it. */
  | { readonly kind: "hang" }
  /** Answers and keeps the answer, then closes the connection without sending it. */
  | { readonly kind: "cut" }
  /** Sends this status and body, whatever the request. */
  | { readonly kind: "raw"; readonly status: number; readonly body: string }
  | { readonly kind: "after"; readonly after: FakeAfterChecks };

/** The certificates the fake serves and trusts, and the book it answers from. */
export interface FakeSignerServiceOptions {
  /** The service's own certificate and key, PEM. */
  readonly certificate: { readonly cert: string; readonly key: string };
  /** The authority whose certificates name the workers, PEM: no other client connects. */
  readonly workerAuthority: string;
  readonly book: FakeSignerBook;
}

/** A request the fake took, by the worker its certificate names. */
export interface FakeTaken {
  readonly worker: string;
  readonly requestId: string;
}

/**
 * A signer service for tests, from spec 5, section 8 alone: `POST /v1/sign` over TLS 1.3 on the
 * loopback, which takes only clients whose certificate its worker authority signed and reads the
 * worker id from the certificate's URI name alone. A body past 4 KiB, or one that is no request
 * of version 1, gets no answer of the service but a 413 or a 400. Its book answers each request.
 */
export interface FakeSignerService {
  /** `https://127.0.0.1:<port>`. */
  readonly origin: string;
  /** The last 1,000 requests it took, in arrival order. */
  requests(): readonly FakeTaken[];
  /** Makes the next request taken meet this event. */
  next(event: FakeServiceEvent): void;
  /** Resolves once it has taken this many requests in all. */
  waitForRequests(count: number): Promise<void>;
  close(): Promise<void>;
}

const maxKept = 1_000;
const workerPrefix = "URI:spiffe://binference.io/worker/";
const workerIdPattern = /^[A-Za-z0-9._-]{1,64}$/;

// The worker the client's certificate names in its URI name, and nothing the client says.
function workerOf(incoming: IncomingMessage): string | undefined {
  const { socket } = incoming;
  const names = socket instanceof TLSSocket ? socket.getPeerCertificate().subjectaltname : "";
  const id = (names ?? "")
    .split(", ")
    .find((name) => name.startsWith(workerPrefix))
    ?.slice(workerPrefix.length);
  return id !== undefined && workerIdPattern.test(id) ? id : undefined;
}

// The body as text, or undefined once it passes 4 KiB.
async function bodyOf(incoming: IncomingMessage): Promise<string | undefined> {
  return new Promise((resolve, reject) => {
    const parts: Buffer[] = [];
    let read = 0;
    incoming.on("data", (part: Buffer) => {
      read += part.byteLength;
      parts.push(part);
    });
    incoming.on("error", reject);
    incoming.on("end", () => {
      resolve(read > signerServiceRequestBytes ? undefined : Buffer.concat(parts).toString("utf8"));
    });
  });
}

function send(outgoing: ServerResponse, status: number, body: string): void {
  outgoing.writeHead(status, { "content-type": "application/json" }).end(body);
}

interface Taking {
  readonly options: FakeSignerServiceOptions;
  readonly events: FakeServiceEvent[];
  readonly onTaken: (taken: FakeTaken) => void;
}

/** One request that passed the worker, size and shape checks. */
interface Took {
  readonly worker: string;
  readonly text: string;
  readonly request: SignerServiceRequest;
  readonly outgoing: ServerResponse;
}

// Sends what the event says in place of the book's answer.
function sendInstead(
  took: Took,
  event: FakeServiceEvent & { readonly kind: "answer" | "raw" },
): void {
  if (event.kind === "raw") {
    send(took.outgoing, event.status, event.body);
    return;
  }
  const { outcome } = event;
  const status = event.status ?? (outcome.outcome === "down" ? 503 : 200);
  const answered: SignerServiceAnswer = {
    version: 1,
    requestId: took.request.requestId,
    ...outcome,
  };
  send(took.outgoing, status, JSON.stringify(z.encode(signerServiceAnswerSchema, answered)));
}

// The book's answer, sent, kept unsent, or lost with the connection, as the event says.
async function answer(
  taking: Taking,
  took: Took,
  event: FakeServiceEvent | undefined,
): Promise<void> {
  const after = event?.kind === "after" ? { after: event.after } : {};
  const { worker, text, request, outgoing } = took;
  const answered = await taking.options.book.answer({ worker, text, request, ...after });
  if (event?.kind === "cut") {
    outgoing.socket?.destroy();
  } else if (event?.kind !== "hang") {
    send(outgoing, 200, JSON.stringify(z.encode(signerServiceAnswerSchema, answered)));
  }
}

// The request once its worker, its size and its shape pass; else it answers 404, 413 or 400.
async function tookOf(
  incoming: IncomingMessage,
  outgoing: ServerResponse,
): Promise<Took | undefined> {
  const worker = workerOf(incoming);
  if (incoming.method !== "POST" || incoming.url !== "/v1/sign" || worker === undefined) {
    send(outgoing, 404, "");
    return undefined;
  }
  const text = await bodyOf(incoming);
  const request = text === undefined ? undefined : decodeServiceRequest(text);
  if (text === undefined || request === undefined) {
    send(outgoing, text === undefined ? 413 : 400, "");
    return undefined;
  }
  return { worker, text, request, outgoing };
}

// Answers one request that passed its checks, as the next event says.
async function take(
  taking: Taking,
  incoming: IncomingMessage,
  outgoing: ServerResponse,
): Promise<void> {
  const took = await tookOf(incoming, outgoing);
  if (took === undefined) {
    return;
  }
  taking.onTaken({ worker: took.worker, requestId: took.request.requestId });
  const event = taking.events.shift();
  if (event?.kind === "answer" || event?.kind === "raw") {
    sendInstead(took, event);
    return;
  }
  await answer(taking, took, event);
}

/** Starts a {@link FakeSignerService} on an ephemeral port of 127.0.0.1. */
export async function startFakeSignerService(
  options: FakeSignerServiceOptions,
): Promise<FakeSignerService> {
  const events: FakeServiceEvent[] = [];
  const taken: FakeTaken[] = [];
  let takenInAll = 0;
  const waiters = new Set<{ readonly count: number; readonly resolve: () => void }>();
  const wake = (): void => {
    for (const waiter of [...waiters].filter(({ count }) => takenInAll >= count)) {
      waiters.delete(waiter);
      waiter.resolve();
    }
  };
  const onTaken = (request: FakeTaken): void => {
    takenInAll += 1;
    taken.push(request);
    taken.splice(0, taken.length - maxKept);
    wake();
  };
  const tls = { ca: options.workerAuthority, requestCert: true, rejectUnauthorized: true };
  const server: Server = createServer(
    { ...options.certificate, ...tls, minVersion: "TLSv1.3" },
    (incoming, outgoing) => {
      take({ options, events, onTaken }, incoming, outgoing).catch(() => outgoing.destroy());
    },
  );
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  const port = typeof address === "object" && address !== null ? address.port : 0;
  return {
    origin: `https://127.0.0.1:${String(port)}`,
    requests: () => [...taken],
    next: (event) => events.push(event),
    waitForRequests: async (count) =>
      new Promise((resolve) => {
        waiters.add({ count, resolve });
        wake();
      }),
    close: async () => {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
