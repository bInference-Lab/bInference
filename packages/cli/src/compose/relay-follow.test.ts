import { isTxHash, type TxHash } from "@binference/chain";
import { createScriptedHttp } from "@binference/core/testing";
import { startBridgeFollowBench } from "@binference/engine/testing";
import { createRelayBridge } from "@binference/relay";
import {
  base,
  recipientOn,
  recordedDeposits,
  recordedOptions,
  tokens,
  wallet,
} from "@binference/relay/testing";
import { describe, expect, it } from "vitest";

const twoHoursMs = 2 * 60 * 60 * 1_000;
const deposit: TxHash = (() => {
  const hash = recordedDeposits.fillBase;
  if (!isTxHash(hash)) {
    throw new Error("Expected the recorded deposit's hash.");
  }
  return hash;
})();

// A keyless Relay after it retired its version 2 requests: the deposit's request answers 410.
function retiredRelay() {
  const url = `https://api.relay.link/requests/v2?hash=${deposit}`;
  const response = { status: 410, headers: {}, body: JSON.stringify({ message: "Gone" }) };
  return createRelayBridge(recordedOptions(createScriptedHttp([{ method: "GET", url, response }])));
}

describe("a keyless Relay bridge once Relay retired its version 2 requests", () => {
  it("is still marked late at 2 hours with Relay's page, and the owner is told once to set a key", async () => {
    const bench = await startBridgeFollowBench({
      readers: [],
      recipient: recipientOn(base),
      minOut: { asset: tokens.baseUsdc, base: 19_899_080n },
      fill: { chain: base, hash: deposit },
      deposit: { hash: deposit, sent: { asset: tokens.usdc, base: 20n * 10n ** 18n }, wallet },
      bridge: retiredRelay(),
    });

    await bench.follow();
    await bench.advance(twoHoursMs);
    await bench.follow();

    expect(await bench.states()).toStrictEqual(["finalized", "late"]);
    expect(bench.notices()).toStrictEqual([
      { key: "notice.bridgeKeyNeeded", values: { venue: "relay" } },
      expect.objectContaining({
        key: "notice.bridgeLate",
        values: expect.objectContaining({
          venue: "relay",
          statusUrl: `https://relay.link/transaction/${deposit}`,
        }) as object,
      }),
    ]);
    expect(bench.logged()).toStrictEqual([
      ["bridge.status_unread", "relay.unauthorized"],
      ["bridge.status_unread", "relay.unauthorized"],
    ]);
  });
});
