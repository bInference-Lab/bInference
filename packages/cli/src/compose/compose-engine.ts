import type { ChainRegistry, Venue } from "@binference/chain";
import {
  BinferenceError,
  type Clock,
  createIdSource,
  type Logger,
  type Random,
} from "@binference/core";
import {
  createEngine,
  createVenueHost,
  type Engine,
  type EnginePush,
  type Simulator,
  type WalletFactsSource,
} from "@binference/engine";
import type { OwnerInfo } from "@binference/protocol";
import {
  createProtocolServer,
  type HttpListenOptions,
  type ProtocolServer,
} from "@binference/server";
import type { ProfileParts } from "./profile-parts.js";

/** The profile parts the engine runs on: custody, the store ports and the USD prices. */
export type EngineParts = Pick<ProfileParts, "custody" | "stores" | "prices">;

/** What the engine and its protocol server are built from besides the profile parts. */
export interface ComposeEngineOptions {
  readonly chains: ChainRegistry;
  /** Every venue the engine may use; the venue host checks their declarations at once. */
  readonly venues: readonly Venue[];
  readonly simulator: Simulator;
  readonly wallets: WalletFactsSource;
  /** The engine's release, for `ready`. */
  readonly version: string;
  readonly owner: OwnerInfo;
  /** The HTTP listener; without it the server serves IPC connections only. */
  readonly http?: HttpListenOptions;
  readonly clock: Clock;
  readonly random: Random;
  readonly logger: Logger;
}

/** The engine with the protocol server that serves its operations and pushes. */
export interface ComposedEngine {
  readonly engine: Engine;
  readonly server: ProtocolServer;
}

// One quote or build that takes longer counts as a venue that is down (spec 6, section 3).
const venueCallTimeoutMs = 5_000;

/**
 * Wires the engine and its protocol server on the profile parts both profiles fill: the server
 * signs callers in through the access store, keeps each write's result under its idempotency key
 * and routes calls to the engine's handlers; the engine's pushes reach the server, which numbers
 * them per topic. A push that fails is logged and never stops the money path.
 */
export function composeEngine(parts: EngineParts, options: ComposeEngineOptions): ComposedEngine {
  const { clock, random, logger, chains } = options;
  const host = createVenueHost({
    venues: options.venues,
    chains,
    clock,
    callTimeoutMs: venueCallTimeoutMs,
  });
  const publish = (push: EnginePush): void => {
    try {
      server.publish(push);
    } catch (error) {
      const code = error instanceof BinferenceError ? error.code : "unexpected";
      logger.warn("engine.push_failed", { errorCode: code });
    }
  };
  const engine = createEngine({
    stores: parts.stores,
    custody: parts.custody,
    prices: parts.prices,
    wallets: options.wallets,
    host,
    simulator: options.simulator,
    chains,
    clock,
    ids: createIdSource({ clock, random }),
    publish,
  });
  const server = createProtocolServer({
    ...(options.http === undefined ? {} : { http: options.http }),
    auth: { access: parts.stores.access },
    idempotency: parts.stores.idempotency,
    handlers: engine.handlers,
    engine: { version: options.version, state: () => "ready", owner: () => options.owner },
    clock,
    random,
    logger: logger.child("server"),
  });
  return { engine, server };
}
