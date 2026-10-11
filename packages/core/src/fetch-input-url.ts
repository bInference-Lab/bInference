/**
 * The URL a `fetch` call names, whichever form the caller gave it in: text, a `URL` or a
 * `Request`. An adapter that serves an SDK's `fetch` over the `Http` port reads it this way.
 */
export function fetchInputUrl(input: string | Readonly<URL> | Readonly<Request>): string {
  if (typeof input === "string") {
    return input;
  }
  return "url" in input ? input.url : input.href;
}
