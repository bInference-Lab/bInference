import {
  answerHeaders,
  BinferenceError,
  type Http,
  type HttpRequest,
  type HttpResponse,
  outboundInit,
  type Secret,
  throwOutboundFailure,
} from "@binference/core";
// oxlint-disable-next-line eslint/no-restricted-imports -- the connection pool of an outbound HTTP adapter that presents a client certificate
import { Agent, request as send } from "undici";

/** The certificate a client presents, its key, and the one authority its server must chain to. */
export interface ClientCertificate {
  /** The client's certificate chain, PEM. */
  readonly cert: string;
  /** The certificate's private key, PEM. */
  readonly key: Secret;
  /** The only authority the server's certificate may chain to, PEM. */
  readonly ca: string;
}

/** What {@link createClientCertHttp} connects with. */
export interface ClientCertHttpOptions {
  readonly certificate: ClientCertificate;
  /** The `user-agent` every request names, such as `binference/<version>`. */
  readonly userAgent: string;
  /** The most bytes an answer may hold; a longer one is refused before it fills memory. */
  readonly maxAnswerBytes: number;
}

/** An {@link Http} whose connections present a client certificate, with the pool it holds. */
export interface ClientCertHttp extends Http {
  /** Closes the pool's connections once their requests end. */
  close(): Promise<void>;
}

function refused(request: HttpRequest, code: `http.${string}`, message: string): BinferenceError {
  return new BinferenceError({
    code,
    message,
    details: { method: request.method, origin: new URL(request.url).origin },
  });
}

// The answer's body as text, refused once it passes `maxBytes`.
async function textOf(
  body: AsyncIterable<Uint8Array>,
  limit: { readonly request: HttpRequest; readonly maxBytes: number },
): Promise<string> {
  const decoder = new TextDecoder();
  const parts: string[] = [];
  let read = 0;
  for await (const chunk of body) {
    read += chunk.byteLength;
    if (read > limit.maxBytes) {
      throw refused(limit.request, "http.answer_too_large", "The answer is too large to read.");
    }
    parts.push(decoder.decode(chunk, { stream: true }));
  }
  return parts.join("") + decoder.decode();
}

/**
 * An outbound {@link Http} for mutual TLS (decision 0420): every connection presents the client
 * certificate, speaks TLS 1.3 at least, and trusts only the given authority, so neither side talks
 * to a stranger. It sends only `https:` requests (`http.not_https` otherwise) and follows no
 * redirect. An answer past `maxAnswerBytes` is refused with `http.answer_too_large`, and a request
 * that gets no answer, a refused handshake among them, rejects as the outbound adapters do: with
 * the signal's reason once it aborted, else a retryable `http.unreachable` that names only the
 * method and the origin. The composition root makes it from the certificate's data; it reads no
 * file itself.
 */
export function createClientCertHttp(options: ClientCertHttpOptions): ClientCertHttp {
  const { certificate, userAgent, maxAnswerBytes } = options;
  const agent = new Agent({
    connect: {
      cert: certificate.cert,
      key: certificate.key.reveal(),
      ca: certificate.ca,
      rejectUnauthorized: true,
      minVersion: "TLSv1.3",
    },
  });
  const request = async (outbound: HttpRequest): Promise<HttpResponse> => {
    if (new URL(outbound.url).protocol !== "https:") {
      throw refused(outbound, "http.not_https", "A client certificate is sent over https only.");
    }
    outbound.signal.throwIfAborted();
    try {
      const answer = await send(outbound.url, {
        dispatcher: agent,
        ...outboundInit(outbound, userAgent),
      });
      const body = await textOf(answer.body, { request: outbound, maxBytes: maxAnswerBytes });
      return { status: answer.statusCode, headers: answerHeaders(answer.headers), body };
    } catch (cause) {
      return throwOutboundFailure(outbound, cause);
    }
  };
  return { request, close: async () => agent.close() };
}
