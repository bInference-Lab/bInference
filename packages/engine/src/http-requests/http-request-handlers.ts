import {
  BinferenceError,
  type Clock,
  createDeadline,
  err,
  ok,
  type Result,
} from "@binference/core";
import {
  httpRequestLimits,
  type HttpRequestArgs,
  type HttpRequestView,
  type ProtocolErrorCode,
} from "@binference/protocol";
import type { RunningTurns } from "../chat/running-turns.js";
import type { EngineCall, EngineHandler } from "../operations/engine-call.js";
import { answerViewOf } from "./answer-view.js";
import type { EngineRequests } from "./engine-requests.js";
import { planRequest, type RequestPlan } from "./request-plan.js";

/** The handler of the agent's API calls (protocol spec, section 7.15). */
export interface HttpRequestHandlers {
  readonly "http/request": EngineHandler<"http/request">;
}

/** What `http/request` sends through, checks its caller with, and times its calls by. */
export interface HttpRequestHandlerOptions {
  readonly requests?: EngineRequests;
  readonly turns: Pick<RunningTurns, "isRuntime">;
  readonly clock: Clock;
}

// The outbound HTTP's own codes, as the protocol names them for the agent.
const failureCodes: Readonly<Record<string, ProtocolErrorCode>> = {
  "http.private_address": "request.address_refused",
  "http.answer_too_large": "request.too_large",
  "http.proxy_auth": "request.proxy_held",
  "http.proxy_refused": "request.proxy_held",
  "http.proxy_unreachable": "request.proxy_held",
  "http.proxy_unusable": "request.proxy_held",
  "http.no_route": "request.proxy_held",
};

// Sends the planned request by the public-only route, within its time limit, and reads its answer.
async function send(
  options: HttpRequestHandlerOptions & { readonly requests: EngineRequests },
  planned: { readonly args: HttpRequestArgs; readonly plan: RequestPlan },
  signal: AbortSignal,
): Promise<Result<HttpRequestView, ProtocolErrorCode>> {
  const { requests, clock } = options;
  const { args, plan } = planned;
  const seconds = args.timeoutSeconds ?? httpRequestLimits.defaultTimeoutSeconds;
  const deadline = createDeadline({ clock, signal, timeoutMs: seconds * 1_000 });
  const startedAt = clock.now();
  const logged = { method: args.method, host: plan.hostname };
  try {
    const response = await requests.http.request({
      method: args.method,
      url: plan.url,
      headers: plan.headers,
      ...(plan.body === undefined ? {} : { body: plan.body }),
      signal: deadline.signal,
      publicOnly: true,
    });
    const durationMs = clock.now() - startedAt;
    requests.logger?.info("request.sent", { ...logged, status: response.status, durationMs });
    const head = args.method === "HEAD";
    return ok(answerViewOf(response, { head, values: plan.values, durationMs }));
  } catch (error) {
    signal.throwIfAborted();
    // A failure is answered by one code, never its message, so nothing the request carried shows.
    const code = error instanceof BinferenceError ? error.code : "";
    const errorCode = deadline.signal.aborted
      ? "request.timed_out"
      : (failureCodes[code] ?? "request.unreachable");
    const durationMs = clock.now() - startedAt;
    requests.logger?.warn("request.failed", { ...logged, errorCode, durationMs });
    return err(errorCode);
  } finally {
    deadline.clear();
  }
}

// A call carries the mark of its agent's running turn; one without a mark counts as marked.
const isOutside = (call: EngineCall<"http/request">): boolean =>
  call.caller.turn?.hasOutsideContent !== false;

/**
 * Creates the handler of `http/request` (decision 0411). It answers only the runtime the engine
 * runs now, and an engine without requests `request.unavailable`. It plans the request first, so
 * a refused address and every refusal of a stand-in send nothing; it sends the plan only to public
 * addresses, follows no redirect, and answers the site's answer with each value masked, or a
 * failure by its code alone. Each request sent leaves one log line with its method, host, status
 * or code and time, never its path, query, headers or body.
 */
export function createHttpRequestHandlers(options: HttpRequestHandlerOptions): HttpRequestHandlers {
  return {
    "http/request": async (call) => {
      const { requests } = options;
      if (!options.turns.isRuntime(call.caller.credential)) {
        return err("auth.scope");
      }
      if (requests === undefined) {
        return err("request.unavailable");
      }
      const { args, signal } = call;
      const planned = await planRequest(args, { requests, outside: isOutside(call), signal });
      if (planned.kind === "address_refused") {
        return err("request.address_refused");
      }
      if (planned.kind === "refused") {
        return ok(planned.view);
      }
      return send({ ...options, requests }, { args, plan: planned.plan }, signal);
    },
  };
}
