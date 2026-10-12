// The agent runtime as the engine runs it, from source, with a scripted model in place of the
// provider's: the end-to-end test of the chat relay starts it as the engine's runtime process.
import {
  createScriptedTransport,
  runNodeRuntime,
  testToolBox,
  textReply,
} from "@binference/runtime/testing";

const transport = createScriptedTransport([textReply("Hello from the agent.")]);

await runNodeRuntime({
  turnSetup: () => ({ transport, tools: testToolBox([]), instructions: "You are a test agent." }),
});
