// The agent runtime as the engine runs it, from source, with a scripted model in place of the
// provider's: the end-to-end test of the chat relay starts it as the engine's runtime process.
import { setTimeout as sleep } from "node:timers/promises";
import {
  createScriptedTransport,
  oneModelChain,
  runNodeRuntime,
  testToolBox,
  textReply,
} from "@binference/runtime/testing";

const transport = createScriptedTransport([textReply("Hello from the agent.")]);
const clock = {
  now: () => Date.now(),
  sleep: async (delayMs: number, signal: AbortSignal) => sleep(delayMs, undefined, { signal }),
};
const models = oneModelChain(transport, clock);

await runNodeRuntime({
  turnSetup: () => ({ models, tools: testToolBox([]), instructions: "You are a test agent." }),
});
