/** The HTTP methods binference sends. */
export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

/** One outbound HTTP request. */
export interface HttpRequest {
  readonly method: HttpMethod;
  readonly url: string;
  readonly headers?: Readonly<Record<string, string>>;
  /** A text body, usually JSON. */
  readonly body?: string;
  /**
   * A body of raw bytes, such as an encrypted message, sent in place of `body`; a request sets
   * one of the two at most.
   */
  readonly bodyBytes?: Readonly<Uint8Array>;
  /** Aborts the request; callers combine their timeout into it. */
  readonly signal: AbortSignal;
  /**
   * Connects only to public internet addresses, such as for an address a client gave: a host
   * that is, or resolves to, a private, loopback, link-local or multicast address rejects with
   * `http.private_address`.
   */
  readonly publicOnly?: boolean;
}

/** The answer to an {@link HttpRequest}. Header names are lowercase. */
export interface HttpResponse {
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string;
}
