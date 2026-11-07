import { err, type Id, jsonValueSchema, ok, type Result } from "@binference/core";
import type { ProtocolErrorCode } from "@binference/protocol";
import type { ChatRelayOptions } from "../chat/chat-relay-parts.js";
import { chatTopic, pushInbox } from "../chat/chat-relay-parts.js";
import { answererOf, type EngineCall, type EngineHandler } from "../operations/engine-call.js";
import { createCredentialRequests, type OpenRequest } from "./credential-requests.js";
import type { CredentialStore } from "./ports.js";

/** The handlers of the agent's credential requests (protocol spec, section 7.7). */
export interface CredentialRequestHandlers {
  readonly "turn/credential": EngineHandler<"turn/credential">;
  readonly "credential/answer": EngineHandler<"credential/answer">;
  readonly "credential/skip": EngineHandler<"credential/skip">;
  readonly "chat/openCredentialRequest": EngineHandler<"chat/openCredentialRequest">;
}

/** What the credential requests read, write and push through. */
export type CredentialRequestOptions = Pick<
  ChatRelayOptions,
  "agentInbox" | "turns" | "ids" | "clock" | "publish" | "intentView"
> & {
  /** Where credentials are stored; without it every request is `credential.unavailable`. */
  readonly credentials?: CredentialStore;
};

/** How long the owner has to answer when the agent names no time: 15 minutes, to find a key. */
const answerSeconds = 900;

type Outcome = "stored" | "skipped" | "expired" | "replaced";

function pushClosed(options: CredentialRequestOptions, request: OpenRequest, outcome: Outcome) {
  const data = jsonValueSchema.parse({ agent: request.agent, request: request.request, outcome });
  options.publish({ topic: chatTopic(request.agent), kind: "chat/credentialRequestClosed", data });
}

// The words the agent reads of the owner's answer: what arrived, never the value.
function answerText(request: OpenRequest, hosts: readonly string[] | undefined): string {
  if (hosts === undefined) {
    return `[binference: the owner skipped your request for the credential ${request.name}; no credential arrived. Say what it blocks, or go on without it; never ask the owner to paste a credential in the chat.]`;
  }
  const where = hosts.length === 0 ? "no host yet" : `only these hosts: ${hosts.join(", ")}`;
  return `[binference: the owner stored the credential ${request.name}; it may be sent to ${where}. Its value never reaches you.]`;
}

// Starts the agent's next turn with the owner's answer, as an answer to a question does.
async function wake(
  options: CredentialRequestOptions,
  answer: { readonly request: OpenRequest; readonly hosts?: readonly string[] },
  call: EngineCall<"credential/answer" | "credential/skip">,
): Promise<Result<{ readonly session: Id<"ses">; readonly turn: Id<"trn"> }, ProtocolErrorCode>> {
  const { ids, clock } = options;
  const turn = ids.next("trn");
  const surface = answererOf(call.caller).surface;
  const stored = await options.agentInbox.add(
    {
      id: ids.next("msg"),
      agentId: answer.request.agent,
      kind: "inbox/message",
      turnId: turn,
      payload: { text: answerText(answer.request, answer.hosts), surface },
      atMs: clock.now(),
      opens: ids.next("ses"),
    },
    call,
  );
  if (!stored.ok) {
    return err(stored.error === "busy" ? "protocol.busy" : "agent.not_found");
  }
  await pushInbox(options, stored.value, call.signal);
  return ok({ session: stored.value.sessionId, turn });
}

// The open request a call names, for its own agent.
function openRequest(
  requests: ReturnType<typeof createCredentialRequests>,
  call: EngineCall<"credential/answer" | "credential/skip">,
): Result<OpenRequest, ProtocolErrorCode> {
  const request = requests.get(call.args.request);
  return request?.agent === call.args.agent ? ok(request) : err("credential.closed");
}

function requestHandler(
  options: CredentialRequestOptions,
  requests: ReturnType<typeof createCredentialRequests>,
): EngineHandler<"turn/credential"> {
  return async (call) => {
    const { credentials, clock, ids } = options;
    if (!options.turns.isRuntime(call.caller.credential)) {
      return err("auth.scope");
    }
    if (credentials === undefined) {
      return err("credential.unavailable");
    }
    const { agent, session, turn, name, reason, allowedHosts, timeoutSeconds } = call.args;
    const stored = await credentials.get(name, call);
    const now = clock.now();
    const request: OpenRequest = {
      request: ids.next("crq"),
      agent,
      session,
      turn,
      name,
      ...(reason === undefined ? {} : { reason }),
      allowedHosts: allowedHosts ?? stored?.allowedHosts ?? [],
      ...(stored === undefined ? {} : { updatedAt: stored.updatedAtMs }),
      createdAt: now,
      closesAt: now + (timeoutSeconds ?? answerSeconds) * 1_000,
    };
    const replaced = requests.open(request);
    if (replaced !== undefined) {
      pushClosed(options, replaced, "replaced");
    }
    const data = jsonValueSchema.parse(request);
    options.publish({ topic: chatTopic(agent), kind: "chat/credentialRequest", data });
    return ok(request);
  };
}

/**
 * Creates the agent's credential requests (decision 0388): `turn/credential`, from the current
 * runtime only, asks the owner for a credential, one open request per agent for its time (15
 * minutes unless the agent names 30 to 3600 seconds), and
 * pushes it on the agent's chat topic. `credential/answer` stores the owner's value with the hosts
 * the owner kept, and `credential/skip` declines; each closes the request and starts the agent's
 * next turn with what arrived, never the value. A request no longer open is `credential.closed`.
 */
export function createCredentialRequestHandlers(
  options: CredentialRequestOptions,
): CredentialRequestHandlers {
  const requests = createCredentialRequests({
    clock: options.clock,
    expired: (request) => {
      pushClosed(options, request, "expired");
    },
  });
  return {
    "turn/credential": requestHandler(options, requests),
    async "credential/answer"(call) {
      const open = openRequest(requests, call);
      if (!open.ok || options.credentials === undefined) {
        return open.ok ? err("credential.unavailable") : open;
      }
      const { value, allowedHosts } = call.args;
      const { name } = open.value;
      await options.credentials.put({ name, value, allowedHosts, atMs: options.clock.now() }, call);
      requests.close(open.value.request);
      pushClosed(options, open.value, "stored");
      return wake(options, { request: open.value, hosts: allowedHosts }, call);
    },
    async "credential/skip"(call) {
      const open = openRequest(requests, call);
      if (!open.ok) {
        return open;
      }
      requests.close(open.value.request);
      pushClosed(options, open.value, "skipped");
      return wake(options, { request: open.value }, call);
    },
    "chat/openCredentialRequest": async (call) => {
      const open = requests.openOf(call.args.agent);
      return Promise.resolve(ok(open === undefined ? {} : { request: open }));
    },
  };
}
