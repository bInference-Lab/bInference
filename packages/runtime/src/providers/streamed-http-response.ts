/** The answer of a `StreamingHttp` request, read while its body still arrives. */
export interface StreamedHttpResponse {
  readonly status: number;
  /** Header names are lowercase. */
  readonly headers: Readonly<Record<string, string>>;
  /** The body's bytes as they arrive. */
  readonly body: AsyncIterable<Uint8Array>;
}
