import { checkPublicUrl } from "@binference/core";
import {
  type HttpHeader,
  type HttpRefusalReason,
  type HttpRefusalView,
  type HttpRequestArgs,
  isBodilessMethod,
} from "@binference/protocol";
import type { RevealedCredential } from "../credentials/credential-record.js";
import { standInsOf, standInStart, withValues } from "./credential-stand-ins.js";
import type { EngineRequests } from "./engine-requests.js";

/** A request ready to send: every stand-in replaced by its value, and where it goes. */
export interface RequestPlan {
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly body?: string;
  /** The URL's host name, matched against each credential's hosts and named in the log. */
  readonly hostname: string;
  /** Each credential the request carries, by name, with its value, for the answer's masking. */
  readonly values: ReadonlyMap<string, string>;
}

/** What a request becomes before anything is sent: a plan, a refusal, or a refused address. */
export type PlannedRequest =
  | { readonly kind: "plan"; readonly plan: RequestPlan }
  | { readonly kind: "refused"; readonly view: HttpRefusalView }
  | { readonly kind: "address_refused" };

/** What a plan reads: the composition root's parts, the caller's mark, and the call's signal. */
export interface PlanContext {
  readonly requests: EngineRequests;
  /** The caller's turn read outside content, or carries no mark. */
  readonly outside: boolean;
  readonly signal: AbortSignal;
}

// Where a request goes, read from its URL once.
interface Target {
  readonly href: string;
  /** The host with its port when the URL names one, as a refusal names it. */
  readonly host: string;
  /** The host name in lower case, a trailing dot dropped. */
  readonly hostname: string;
  readonly port: string;
  /** The query as it is sent, stand-ins as the agent wrote them. */
  readonly search: string;
}

// A field value Node sends: a tab, printable ASCII and the Latin-1 range, no line break.
const sendableValue = /^[\t -~\u0080-ÿ]*$/u;

const bareHost = (host: string): string => host.toLowerCase().replace(/\.$/u, "");

// The URL, when it is an `https:` URL to a public host that is not binference's own.
function targetOf(text: string, ownHosts: readonly string[]): Target | undefined {
  const checked = checkPublicUrl(text);
  if (!checked.ok || checked.value.protocol !== "https:") {
    return undefined;
  }
  const { href, host, port, search } = checked.value;
  const hostname = bareHost(checked.value.hostname);
  const own = ownHosts.some((each) => bareHost(each) === hostname);
  return own ? undefined : { href, host, hostname, port, search };
}

// Whether every stand-in the URL's text holds sits in its query, before any fragment.
function standInsInQuery(text: string): boolean {
  const hash = text.indexOf("#");
  const end = hash === -1 ? text.length : hash;
  const query = text.indexOf("?");
  let at = text.indexOf(standInStart);
  while (at !== -1) {
    if (query === -1 || query > end || at < query || at > end) {
      return false;
    }
    at = text.indexOf(standInStart, at + 1);
  }
  return true;
}

function refusal(
  target: Target,
  reason: HttpRefusalReason,
  credential: string | undefined,
): PlannedRequest {
  const view = { kind: "refused", reason, host: target.host } as const;
  return { kind: "refused", view: credential === undefined ? view : { ...view, credential } };
}

// The texts a stand-in may sit in: the query as it is sent, the headers' values and the body.
function textsOf(target: Target, args: HttpRequestArgs): readonly string[] {
  const values = (args.headers ?? []).map(({ value }) => value);
  return [target.search, ...values, ...(args.body === undefined ? [] : [args.body])];
}

// The credentials the request names, each read once, or the refusal of the first that cannot go.
async function credentialsOf(
  names: readonly string[],
  target: Target,
  context: PlanContext,
): Promise<
  { readonly values: ReadonlyMap<string, string> } | { readonly refused: PlannedRequest }
> {
  const values = new Map<string, string>();
  for (const name of names) {
    // oxlint-disable-next-line eslint/no-await-in-loop -- one value read at a time, stopped at the first refusal
    const stored: RevealedCredential | undefined = await context.requests.reveal(name, context);
    if (stored === undefined) {
      return { refused: refusal(target, "credential_unknown", name) };
    }
    if (target.port !== "" || !stored.allowedHosts.includes(target.hostname)) {
      return { refused: refusal(target, "credential_host", name) };
    }
    values.set(name, stored.value.reveal());
  }
  return { values };
}

// The headers with each stand-in's value put in, or the first header that cannot carry its value.
function headersWith(
  headers: readonly HttpHeader[],
  values: ReadonlyMap<string, string>,
): { readonly headers: Readonly<Record<string, string>> } | { readonly unfit: HttpHeader } {
  const sent: Record<string, string> = {};
  for (const header of headers) {
    const value = withValues(header.value, values);
    if (!sendableValue.test(value)) {
      return { unfit: header };
    }
    sent[header.name] = value;
  }
  return { headers: sent };
}

function planOf(
  target: Target,
  args: HttpRequestArgs,
  values: ReadonlyMap<string, string>,
): PlannedRequest {
  const headers = headersWith(args.headers ?? [], values);
  if ("unfit" in headers) {
    return refusal(target, "value_unfit", standInsOf(headers.unfit.value).names[0]);
  }
  const plan: RequestPlan = {
    url: withValues(target.href, values, encodeURIComponent),
    headers: headers.headers,
    ...(args.body === undefined ? {} : { body: withValues(args.body, values) }),
    hostname: target.hostname,
    values,
  };
  return { kind: "plan", plan };
}

/**
 * Plans the agent's request before anything is sent (decision 0411): an `https:` URL to a public
 * host that is not binference's own, else `address_refused`; every stand-in in the URL's query, a
 * header's value or the body, each whole; with any stand-in, a method other than `GET` or `HEAD`
 * only in a turn that read no outside content; and each credential stored and listing the URL's
 * host, on the default port. Each value is read once and put in, percent-encoded in the query.
 */
export async function planRequest(
  args: HttpRequestArgs,
  context: PlanContext,
): Promise<PlannedRequest> {
  const target = targetOf(args.url, context.requests.ownHosts());
  if (target === undefined) {
    return { kind: "address_refused" };
  }
  if (!standInsInQuery(args.url)) {
    return refusal(target, "standin_place", undefined);
  }
  const found = textsOf(target, args).map(standInsOf);
  if (found.some(({ malformed }) => malformed)) {
    return refusal(target, "standin_malformed", undefined);
  }
  const names = [...new Set(found.flatMap((each) => each.names))];
  if (names.length > 0 && context.outside && !isBodilessMethod(args.method)) {
    return refusal(target, "credential_outside", names[0]);
  }
  const values = await credentialsOf(names, target, context);
  return "refused" in values ? values.refused : planOf(target, args, values.values);
}
