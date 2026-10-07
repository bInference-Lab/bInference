import { serveMcpOverStdio } from "../server/serve-stdio.js";
import { createFakeProtocolClient } from "../testing/fake-protocol-client.js";
import { createRecordingLogger } from "../testing/recording-logger.js";
import { portfolio, proposedIntent } from "../testing/wire-fixtures.js";

// The MCP server over this process's stdin and stdout, on a fake engine, as the stdio tests start
// it. It exits once the MCP client closes stdin.
const client = createFakeProtocolClient({
  "intent/propose": proposedIntent("awaiting_confirmation"),
  "portfolio/get": portfolio(),
});
await serveMcpOverStdio(
  { client, version: "0.0.0", logger: createRecordingLogger() },
  new AbortController().signal,
);
