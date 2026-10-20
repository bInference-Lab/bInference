import { setTimeout as sleep } from "node:timers/promises";
import { jsonValueSchema } from "@binference/core";
import {
  agentToolBox,
  callsReply,
  createScriptedTransport,
  createTestChain,
  runNodeRuntime,
  textReply,
} from "@binference/runtime/testing";
import { crashFirstBuys, crashLaunchTerms } from "./crash-launch-terms.js";

// The agent runtime of a crash run's chat, as the engine runs it, from source, with a scripted
// model in place of the provider's: the owner's first message gets a draft of the owner's launch,
// with the photo of that message, through the agent's own `launch_draft` tool, then a line of
// text. A restarted engine starts a runtime of its own on the same script.
const terms = crashLaunchTerms("coin");
const firstBuy = { asset: terms.pairWith, base: crashFirstBuys.coin.toString() };
const launch = jsonValueSchema.parse({ ...terms, firstBuy });
const transport = createScriptedTransport([
  callsReply([{ name: "launch_draft", args: { launch, photo: 1 } }]),
  textReply("Drafted. Tap Start launch."),
]);
const clock = {
  now: () => Date.now(),
  sleep: async (delayMs: number, signal: AbortSignal) => sleep(delayMs, undefined, { signal }),
};
const models = createTestChain([{ name: "test/model", transport, readsImages: true }], { clock });

await runNodeRuntime({
  turnSetup: (place, _settings, client) => ({
    models,
    tools: agentToolBox({ agent: place.agent, client, turn: place }),
    instructions: "You are a test agent.",
  }),
});
