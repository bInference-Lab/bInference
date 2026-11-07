import { type Clock, idSchema } from "@binference/core";
import { describe, expect, it } from "vitest";
import { createCredentialRequests, type OpenRequest } from "./credential-requests.js";

const agent = idSchema("agt").parse("agt_0190f1c2-3a4b-7c5d-8e6f-000000000001");

function requestOf(id: string, closesAt: number): OpenRequest {
  return {
    request: idSchema("crq").parse(`crq_0190f1c2-3a4b-7c5d-8e6f-00000000000${id}`),
    agent,
    session: idSchema("ses").parse("ses_0190f1c2-3a4b-7c5d-8e6f-000000000001"),
    turn: idSchema("trn").parse("trn_0190f1c2-3a4b-7c5d-8e6f-000000000001"),
    name: "X_KEY",
    allowedHosts: [],
    createdAt: 0,
    closesAt,
  };
}

// A clock whose timers never fire, so only a read finds a request past its time.
function stalledClock(now: { readonly at: number }): Clock {
  return { now: () => now.at, sleep: async () => new Promise<void>(() => undefined) };
}

describe("the open credential requests", () => {
  it("close a request a read finds past its time, once, when its timer has not fired", () => {
    const now = { at: 0 };
    const expired: OpenRequest[] = [];
    const requests = createCredentialRequests({
      clock: stalledClock(now),
      expired: (request) => expired.push(request),
    });
    const request = requestOf("1", 1_000);
    requests.open(request);
    expect(requests.named("X_KEY")).toStrictEqual([request]);
    now.at = 1_000;
    expect(requests.get(request.request)).toBeUndefined();
    expect(requests.openOf(agent)).toBeUndefined();
    expect(expired).toStrictEqual([request]);
  });

  it("answer false when closing a request that is not open", () => {
    const requests = createCredentialRequests({
      clock: stalledClock({ at: 0 }),
      expired: () => undefined,
    });
    expect(requests.close("crq_0190f1c2-3a4b-7c5d-8e6f-000000000001")).toBe(false);
  });
});
