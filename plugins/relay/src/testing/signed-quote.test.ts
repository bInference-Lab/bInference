import type { HttpRequest } from "@binference/plugin-sdk";
import { successOf } from "@binference/plugin-sdk/testing";
import { privateKeyToAccount } from "viem/accounts";
import { describe, expect, it } from "vitest";
import { createRelayBridge } from "../relay-bridge.js";
import { recordedOptions, requestFor, tokens } from "./bridge-fixtures.js";
import { signedQuoteFor, signedQuoteOutput } from "./signed-quote.js";

const solverKey = `0x${"5a".repeat(32)}` as const;
const live = { signal: new AbortController().signal };

// Relay's API answering every quote with the recorded one made out for the recorded wallet and
// recipient, signed by the test's key.
const signedApi = {
  request: async (request: HttpRequest) => {
    request.signal.throwIfAborted();
    const body = await signedQuoteFor({
      depositor: "0x1111111111111111111111111111111111111111",
      recipient: "0x2222222222222222222222222222222222222222",
      solverKey,
      deadline: 1_794_151_754,
    });
    return { status: 200, headers: {}, body };
  },
};

describe("a recorded Relay quote signed by a test's key", () => {
  const request = requestFor(tokens.usdc, tokens.baseUsdc);

  it("is taken by a bridge whose solver is that key, for the recorded output", async () => {
    const solver = privateKeyToAccount(solverKey).address;
    const bridge = createRelayBridge({ ...recordedOptions(signedApi), solver });

    const quote = successOf(await bridge.quote(request, live));

    expect(quote.minOut.base).toBe(signedQuoteOutput);
  });

  it("is refused by Relay's own bridge as an order Relay's solver never signed", async () => {
    const bridge = createRelayBridge(recordedOptions(signedApi));

    await expect(bridge.quote(request, live)).rejects.toMatchObject({
      code: "relay.unsigned_order",
    });
  });
});
