import { createConnection } from "node:net";
import {
  createProtocolClient,
  type ProtocolClient,
  type ProtocolClientOptions,
} from "@binference/client";
import { operations } from "@binference/protocol";
import { WebSocket } from "ws";
import type { StartLine } from "../control/control-line.schema.js";
import { createCallSlots } from "../engine-chat/call-slots.js";
import { createEngineToolClient } from "../engine-chat/engine-tool-client.js";
import { createProtocolContextSource } from "../engine-chat/protocol-context-source.js";
import { createProtocolEngineChat } from "../engine-chat/protocol-engine-chat.js";
import { createProtocolImageReader } from "../engine-chat/protocol-image-reader.js";
import { createReadLimit } from "../engine-chat/read-limit.js";
import { createResendingClient, type ResendPorts } from "../engine-chat/resending-client.js";
import type { EngineLink } from "./runtime-host.js";

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

// The client holds 60 calls waiting at once (its `maxPendingCalls`). Reads take at most 40 of
// them, so the turns' own calls, usage records and wake-ups always find room (decision 0442).
const readsAtOnce = 40;

/**
 * The runtime's link over a client signed in to the engine: its chat, each turn's context, the
 * owner's images and the tools' calls. A call the engine refused before it ran goes again where
 * decision 0442 says: the turn's own calls, the inbox, the wake-ups and every read; a call its
 * client had no room for waits for one of the link's calls to settle; at most 40 reads run at
 * once, and the rest wait their turn.
 */
export function linkOverClient(
  client: Pick<ProtocolClient, "call" | "subscribe" | "close">,
  ports: ResendPorts,
): EngineLink {
  const slots = createCallSlots(client, ports.clock);
  const resending = createResendingClient(slots, ports);
  const tools = createEngineToolClient({
    client: slots,
    resending,
    reads: createReadLimit(readsAtOnce),
  });
  const chat = {
    call: slots.call,
    subscribe: client.subscribe,
  } satisfies Pick<ProtocolClient, "call" | "subscribe">;
  return {
    chat: createProtocolEngineChat(chat, resending),
    context: createProtocolContextSource(tools),
    images: createProtocolImageReader(tools),
    client: tools,
    close: () => client.close(),
  };
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
  return linkOverClient(client, context);
}
