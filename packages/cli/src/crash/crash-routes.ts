// oxlint-disable-next-line eslint/no-restricted-imports -- the crash suite serves its services on loopback; nothing ships a listener
import type { ServerResponse } from "node:http";
import type { HttpResponse } from "@binference/core";

/**
 * A service the crash services answer at `/<name>`: its answer to a request, or `undefined` to
 * hold the request unanswered until the services close.
 */
export type CrashApi = (request: {
  readonly path: string;
  readonly body: string;
}) => Promise<HttpResponse | undefined>;

/** The services routed by name, and the requests they hold. */
export interface Routes {
  readonly apis: Map<string, CrashApi>;
  readonly held: ServerResponse[];
}

/** No service routed yet, and no request held. */
export function createRoutes(): Routes {
  return { apis: new Map(), held: [] };
}

/**
 * Answers a request to a routed service with the path after its name, or holds it; answers
 * whether a routed service took it.
 */
export async function routedAnswer(
  routes: Routes,
  call: { readonly path: string; readonly body: string; readonly outgoing: ServerResponse },
): Promise<boolean> {
  const [, name = "", rest = ""] = /^\/([a-z]+)(.*)$/u.exec(call.path) ?? [];
  const api = routes.apis.get(name);
  if (api === undefined) {
    return false;
  }
  const answer = await api({ path: rest, body: call.body });
  if (answer === undefined) {
    routes.held.push(call.outgoing);
  } else {
    call.outgoing.writeHead(answer.status, answer.headers).end(answer.body);
  }
  return true;
}
