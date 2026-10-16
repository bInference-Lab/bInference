import type { IdSource } from "@binference/core";
import type { EnginePush } from "@binference/engine";
import { createDevicePairing, createLockoutNotices } from "@binference/engine/access";
import type { UploadShelf } from "@binference/engine/chat";
import type { EngineHandlerTable } from "@binference/engine/surfaces";
import { createProtocolServer, type MiniAppAuth, type ProtocolServer } from "@binference/server";
import type { ComposeEngineOptions, EngineParts } from "./compose-engine.js";
import type { TelegramParts } from "./compose-telegram.js";

/** What the server is built from besides the profile parts and the options. */
export interface ServerParts {
  readonly handlers: EngineHandlerTable;
  readonly publish: (push: EnginePush) => void;
  readonly ids: IdSource;
  /** The owner's uploads: the server fills the shelf the engine reads them from. */
  readonly uploads: UploadShelf;
}

// The owner's bot as the Mini App's sign-in reads it: its token checks each launch's signature,
// and the paired owner's numeric Telegram id is the one id that signs in.
function miniAppOf(telegram: TelegramParts | undefined): { readonly miniApp?: MiniAppAuth } {
  if (telegram === undefined) {
    return {};
  }
  const { botToken, owners } = telegram;
  return { miniApp: { botToken, ownerId: async (call) => (await owners.get(call))?.userId } };
}

/**
 * The engine's protocol server over the handlers: sign-ins through the access store and the
 * owner's bot, idempotent writes, device pairing, the console, and the owner's notice of each
 * lockout.
 */
export function composeServer(
  parts: EngineParts,
  options: ComposeEngineOptions,
  given: ServerParts,
): ProtocolServer {
  const { clock, random, logger, consoleFiles } = options;
  const { access } = parts.stores;
  const pairing = createDevicePairing({ access, clock, ids: given.ids, publish: given.publish });
  return createProtocolServer({
    ...(options.http === undefined ? {} : { http: options.http }),
    auth: { access, ...miniAppOf(options.telegram) },
    pairing,
    ...(consoleFiles === undefined ? {} : { consoleFiles }),
    idempotency: parts.stores.idempotency,
    uploads: given.uploads,
    handlers: given.handlers,
    engine: {
      version: options.version,
      state: options.state ?? (() => "ready"),
      owner: options.owner,
    },
    clock,
    random,
    logger: logger.child("server"),
    onLockout: createLockoutNotices({ access, publish: given.publish }),
  });
}
