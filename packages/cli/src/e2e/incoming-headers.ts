// oxlint-disable-next-line eslint/no-restricted-imports -- the type of a request a test's fake service receives
import type { IncomingMessage } from "node:http";

/**
 * The headers of a request a test's fake service received, as an `HttpRequest` carries them: each
 * header Node gives as one string, by its lowercase name.
 */
export function headersOf(incoming: IncomingMessage): Readonly<Record<string, string>> {
  return Object.fromEntries(
    Object.entries(incoming.headers).flatMap(([name, value]) =>
      typeof value === "string" ? [[name, value]] : [],
    ),
  );
}
