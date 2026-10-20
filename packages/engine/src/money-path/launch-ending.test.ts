import { describe, expect, it } from "vitest";
import type { IntentSnapshot } from "../intents/create-stored-intents.js";
import { requestDocument } from "../intents/intent-documents.schema.js";
import { testCoin, testNowMs } from "../intents/test-intents.js";
import { tokenLaunchQuoteDocument } from "../intents/token-launch-quote.js";
import type { EnginePush } from "../pushes/engine-push.js";
import type { LaunchHost } from "../venues/launch-host.js";
import { toldIfEnded } from "./launch-ending.js";
import { testLaunch } from "./test-launches.js";

const quoteOf = (pin?: { readonly upload: number }) =>
  tokenLaunchQuoteDocument.encode({
    venue: testLaunch.venue,
    settings: [],
    token: testCoin,
    tokenDecimals: 18,
    fee: { asset: testCoin, base: 0n },
    ...(pin === undefined ? {} : { pin, metadataUri: "ipfs://fake-1" }),
    pinWaitUntilMs: testNowMs,
    quotedAtMs: testNowMs,
  });

/** How a launch stopped: its stored quote, and what the host says of its launchpad. */
interface Stopped {
  readonly quote?: ReturnType<typeof quoteOf>;
  readonly takesUpload: boolean | undefined;
}

// The owner's notice of a launch that ended, from a launch host that answers `takesUpload` so.
function noticeOf(stopped: Stopped) {
  const pushes: EnginePush[] = [];
  const host: Pick<LaunchHost, "takesUpload"> = { takesUpload: () => stopped.takesUpload };
  const record = {
    id: "int_test",
    agentId: testLaunch.agent,
    state: "failed_check",
    reason: "upload_lost",
    request: requestDocument.encode(testLaunch),
    ...(stopped.quote === undefined ? {} : { quote: stopped.quote }),
  };
  const options = { launch: { host, publish: (push: EnginePush) => pushes.push(push) } };
  toldIfEnded(options as never, { record } as unknown as IntentSnapshot);
  return pushes.map((push) => push.data);
}

describe("the notice of a launch that stopped", () => {
  it.each<[string, Stopped, string]>([
    ["a quote with no pin", { quote: quoteOf(), takesUpload: true }, "yes"],
    ["a quote with a pin", { quote: quoteOf({ upload: 1 }), takesUpload: false }, "no"],
    ["no quote, on a launchpad that uploads nothing", { takesUpload: false }, "yes"],
    ["no quote, on a launchpad that uploads", { takesUpload: true }, "no"],
    ["no quote, on a launchpad the engine no longer holds", { takesUpload: undefined }, "no"],
  ])("says whether anything went public for %s", (_case, stopped, isPrivate) => {
    expect(noticeOf(stopped)).toMatchObject([{ values: { private: isPrivate } }]);
  });
});
