import type { ProtocolClient } from "@binference/client";
import { BinferenceError } from "@binference/core";
import { createManualClock, createSeededRandom } from "@binference/core/testing";
import { describe, expect, it } from "vitest";
import { nthTestId } from "../testing/memory-agent-stores.js";
import { linkOverClient } from "./engine-link.js";

const busy = new BinferenceError({ code: "protocol.busy", message: "busy", retryable: true });
const agent = nthTestId("agt", 1);

function live(): AbortSignal {
  return new AbortController().signal;
}

// A client that refuses each operation's first call busy and answers the rest with what the
// operation's result needs, noting every attempt's operation.
function busyOnce() {
  const attempts: string[] = [];
  const answers: Readonly<Record<string, unknown>> = { "agent/readFile": { text: "Be brief." } };
  const client: Pick<ProtocolClient, "call" | "subscribe" | "close"> = {
    async call(op) {
      const isFirst = !attempts.includes(op);
      attempts.push(op);
      if (isFirst) {
        throw busy;
      }
      return answers[op] ?? {};
    },
    subscribe: () => () => undefined,
    close: () => undefined,
  };
  return { client, attempts };
}

describe("linkOverClient", () => {
  it("reads a turn's context again when the engine refused it busy", async () => {
    const clock = createManualClock(0);
    const { client, attempts } = busyOnce();
    const link = linkOverClient(client, { clock, random: createSeededRandom(4) });
    const read = link.context.workspaceFile({ agent, file: "RULES.md" }, live());
    await clock.advance(8_000);
    expect(await read).toBe("Be brief.");
    expect(attempts).toStrictEqual(["agent/readFile", "agent/readFile"]);
  });

  it("reads the owner's image again when the engine refused it busy", async () => {
    const clock = createManualClock(0);
    const { client, attempts } = busyOnce();
    const link = linkOverClient(client, { clock, random: createSeededRandom(4) });
    const message = nthTestId("msg", 1);
    const read = link.images.read({ agent, message, image: "0" }, live()).catch(() => "failed");
    await clock.advance(8_000);
    await read;
    expect(attempts.slice(0, 2)).toStrictEqual(["inbox/readImage", "inbox/readImage"]);
  });

  it("reads again through the tools' client, and sends a proposal once", async () => {
    const clock = createManualClock(0);
    const { client, attempts } = busyOnce();
    const link = linkOverClient(client, { clock, random: createSeededRandom(4) });
    const read = link.client.call("portfolio/get", { agent }, { signal: live() });
    const proposed = link.client
      .call("intent/propose", {} as never, { signal: live() })
      .catch(() => "refused");
    await clock.advance(8_000);
    expect([await read, await proposed]).toStrictEqual([{}, "refused"]);
    expect(attempts.toSorted()).toStrictEqual(["intent/propose", "portfolio/get", "portfolio/get"]);
  });
});
