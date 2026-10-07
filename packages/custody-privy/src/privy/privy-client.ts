import {
  BinferenceError,
  type Clock,
  type Http,
  type HttpMethod,
  type HttpRequest,
  type Secret,
} from "@binference/core";
import { PrivyClient } from "@privy-io/node";

/** What a Privy client needs: the owner's app, an `Http` adapter and a clock for timeouts. */
export interface PrivyApiOptions {
  readonly http: Http;
  readonly clock: Clock;
  /** The Privy app id, which is public. */
  readonly appId: string;
  /** The Privy app secret; it authenticates calls and signs nothing by itself. */
  readonly appSecret: Secret;
  /** Privy's API origin, `https://api.privy.io` unless a test serves another. */
  readonly origin?: string;
  /** How long one call may take, 15 s unless set. */
  readonly timeoutMs?: number;
}

/** The options a call's SDK client is made from, checked once. */
export interface PrivySettings {
  readonly http: Http;
  readonly clock: Clock;
  readonly appId: string;
  readonly appSecret: Secret;
  readonly origin: string;
  readonly timeoutMs: number;
}

const defaultOrigin = "https://api.privy.io";
const defaultTimeoutMs = 15_000;
const originPattern = /^https:\/\/[a-z0-9.-]+(?::\d{1,5})?$/;
const methods: ReadonlySet<string> = new Set<HttpMethod>(["GET", "POST", "PUT", "DELETE"]);

function isMethod(text: string): text is HttpMethod {
  return methods.has(text);
}

/** Checks the options: the origin must be https with no path. */
export function privySettings(options: PrivyApiOptions): PrivySettings {
  const origin = options.origin ?? defaultOrigin;
  if (!originPattern.test(origin)) {
    throw new BinferenceError({
      code: "custody.origin_invalid",
      message: "Privy's API origin must be an https origin with no path.",
    });
  }
  return { ...options, origin, timeoutMs: options.timeoutMs ?? defaultTimeoutMs };
}

function refuseRequest(): BinferenceError {
  return new BinferenceError({
    code: "custody.privy_request_unsupported",
    message: "The Privy SDK asked for a request this adapter does not send.",
  });
}

function urlOf(input: string | URL | Request): string {
  if (typeof input === "string") {
    return input;
  }
  return input instanceof URL ? input.href : input.url;
}

function methodOf(init: RequestInit | undefined): HttpMethod {
  const method = (init?.method ?? "GET").toUpperCase();
  if (!isMethod(method)) {
    throw refuseRequest();
  }
  return method;
}

// The SDK sends JSON bodies as text; any other body is refused, never sent another way.
function bodyOf(init: RequestInit | undefined): { readonly body?: string } {
  const body = init?.body ?? undefined;
  if (body !== undefined && typeof body !== "string") {
    throw refuseRequest();
  }
  return body === undefined ? {} : { body };
}

function httpRequestOf(
  input: string | URL | Request,
  init: RequestInit | undefined,
  signal: AbortSignal,
): HttpRequest {
  return {
    method: methodOf(init),
    url: urlOf(input),
    headers: Object.fromEntries(new Headers(init?.headers).entries()),
    ...bodyOf(init),
    signal: init?.signal ? AbortSignal.any([signal, init.signal]) : signal,
  };
}

/**
 * The `fetch` the SDK calls, over the core `Http` port: outbound HTTP keeps one adapter, and a
 * test serves Privy's API through the same port. Each request stops when the call's signal or the
 * SDK's own timeout aborts. Header names arrive in lowercase.
 */
export function fetchOver(
  http: Http,
  signal: AbortSignal,
): (input: string | URL | Request, init?: RequestInit) => Promise<Response> {
  return async (input, init) => {
    const response = await http.request(httpRequestOf(input, init, signal));
    const empty = response.status === 204 || response.status === 304;
    return new Response(empty ? null : response.body, {
      status: response.status,
      headers: response.headers,
    });
  };
}

/**
 * Privy's official Node SDK for one call: its requests go through the `Http` port and stop with
 * the call's signal. The SDK's own retries are off, since nothing here retries, and so are its
 * logs; the request expiry is set by each signing call from the clock.
 */
export function privyClientFor(settings: PrivySettings, signal: AbortSignal): PrivyClient {
  return new PrivyClient({
    appId: settings.appId,
    appSecret: settings.appSecret.reveal(),
    apiUrl: settings.origin,
    fetch: fetchOver(settings.http, signal),
    maxRetries: 0,
    timeout: settings.timeoutMs,
    logLevel: "off",
    requestExpiry: { disabled: true },
  });
}
