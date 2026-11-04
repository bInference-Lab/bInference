// oxlint-disable-next-line eslint/no-restricted-imports -- the types of a listener that serves a test's fakes
import type { IncomingMessage, ServerResponse } from "node:http";
import { text as readBody } from "node:stream/consumers";
import type { Http, HttpMethod } from "@binference/core";
import { z } from "zod";
import { headersOf } from "./incoming-headers.js";

const methodSchema = z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]);

/**
 * A listener for an HTTPS server that stands in for outside services by their host names: each
 * request goes to the fake its `Host` header names, such as the fake Privy for `api.privy.io`, as
 * an `HttpRequest` to `https://<host><path>`, and its answer goes back as it came. A host with no
 * fake gets 404, and a fake that throws 500.
 */
export function answerFromFakes(
  services: ReadonlyMap<string, Http>,
): (incoming: IncomingMessage, outgoing: ServerResponse) => void {
  const answer = async (incoming: IncomingMessage, outgoing: ServerResponse): Promise<void> => {
    const body = await readBody(incoming);
    const host = incoming.headers.host ?? "";
    const service = services.get(host.split(":")[0] ?? "");
    if (service === undefined) {
      outgoing.writeHead(404).end();
      return;
    }
    const method: HttpMethod = methodSchema.parse(incoming.method);
    const reply = await service.request({
      method,
      url: `https://${host}${incoming.url ?? "/"}`,
      headers: headersOf(incoming),
      ...(body === "" ? {} : { body }),
      signal: AbortSignal.timeout(60_000),
    });
    outgoing.writeHead(reply.status, reply.headers).end(reply.body);
  };
  return (incoming, outgoing) => {
    answer(incoming, outgoing).catch(() => {
      outgoing.writeHead(500).end();
    });
  };
}
