import { createConnection } from "node:net";
import { createProtocolClient, type ProtocolClientOptions } from "@binference/client";
import { operations } from "@binference/protocol";
import { WebSocket } from "ws";
import type { StartLine } from "../control/control-line.schema.js";
import { createProtocolEngineChat } from "../relay/protocol-engine-chat.js";
import type { EngineLink } from "./run-runtime.js";

type ClientPorts = Pick<ProtocolClientOptions, "clock" | "random" | "logger">;

const ignore = (): void => undefined;

// The engine serves its protocol over WebSocket on its IPC socket; the host name only fills the
// request line. Errors reach the client through `close`, which always follows them.
function socketOn(endpoint: string): ProtocolClientOptions["openSocket"] {
  return () =>
    new WebSocket("ws://localhost/ws", {
      createConnection: () => createConnection({ path: endpoint }).on("error", ignore),
      perMessageDeflate: false,
    }).on("error", ignore);
}

/**
 * Signs the runtime in to the engine over IPC with the token of the start line, as client kind
 * `runtime`. Resolves once the engine answered `ready`, with the engine's side of chat over the
 * connection; the client reconnects on its own after.
 */
export async function connectEngine(
  start: StartLine,
  context: ClientPorts & { readonly version: string; readonly signal: AbortSignal },
): Promise<EngineLink> {
  const client = createProtocolClient({
    operations,
    openSocket: socketOn(start.endpoint),
    client: { kind: "runtime", version: context.version },
    credential: { token: start.token },
    clock: context.clock,
    random: context.random,
    logger: context.logger,
  });
  await client.connect(context.signal);
  return { chat: createProtocolEngineChat(client), close: () => client.close() };
}
