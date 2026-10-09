import type { Amount, ChainRegistry, Venue } from "@binference/chain";
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
  type Executor,
  type PositionStore,
  type Simulator,
  type WalletFactsSource,
} from "@binference/engine";
import type { EngineState, OwnerInfo } from "@binference/protocol";
import {
  createProtocolServer,
  type HttpListenOptions,
  type OperationHandlers,
  type ProtocolServer,
} from "@binference/server";
import { type ComposedTelegram, composeTelegram, type TelegramParts } from "./compose-telegram.js";
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
  /** Takes each confirmed live intent onto its wallet's queue. */
  readonly executor: Executor;
  /** Executions, arrivals and positions, the paper portfolio's too. */
  readonly positions: PositionStore;
  /** What a paper portfolio starts with: config's `defaults.paper.balances`, resolved to assets. */
  readonly paperBalances: readonly Amount[];
  /** The engine's release, for `ready`. */
  readonly version: string;
  readonly owner: OwnerInfo;
  /** The HTTP listener; without it the server serves IPC connections only. */
  readonly http?: HttpListenOptions;
  /** Whether the engine serves calls yet; `ready` when left out. */
  readonly state?: () => EngineState;
  /**
   * Whether the unlock mode has not given the engine the agent key yet, so it signs nothing;
   * never locked when left out.
   */
  readonly isLocked?: () => boolean;
  /** Handlers of operations the composition root answers, such as `engine/status`. */
  readonly handlers?: OperationHandlers;
  /** The owner's bot; without it the engine shows no card in Telegram. */
  readonly telegram?: TelegramParts;
  readonly clock: Clock;
  readonly random: Random;
  readonly logger: Logger;
}

/** The engine with the protocol server that serves its operations and pushes. */
export interface ComposedEngine {
  readonly engine: Engine;
  readonly server: ProtocolServer;
  /** Where the engine's pushes go: the server, and the owner's bot when there is one. */
  readonly publish: (push: EnginePush) => void;
  /** The owner's bot joined to the engine, when the options name one. */
  readonly telegram?: ComposedTelegram;
}

// One quote or build that takes longer counts as a venue that is down (spec 6, section 3).
const venueCallTimeoutMs = 5_000;

// The owner's bot, when the options name one, answers its presses through the engine.
function joinTelegram(
  parts: EngineParts,
  options: ComposeEngineOptions,
  engine: Engine,
): ComposedTelegram | undefined {
  const { telegram, owner, chains, clock, logger } = options;
  return telegram === undefined
    ? undefined
    : composeTelegram(telegram, {
        stores: parts.stores,
        answer: engine.answer,
        chains,
        owner,
        clock,
        logger: logger.child("telegram"),
      });
}

/**
 * Wires the engine and its protocol server on the profile parts both profiles fill: the server
 * signs callers in through the access store, keeps each write's result under its idempotency key
 * and routes calls to the engine's handlers; the engine's pushes reach the server, which numbers
 * them per topic. A push that fails is logged and never stops the money path. With the owner's
 * bot, card pushes also reach Telegram.
 */
export function composeEngine(parts: EngineParts, options: ComposeEngineOptions): ComposedEngine {
  const { clock, random, logger, chains, venues } = options;
  const host = createVenueHost({ venues, chains, clock, callTimeoutMs: venueCallTimeoutMs });
  const publish = (push: EnginePush): void => {
    try {
      server.publish(push);
    } catch (error) {
      const code = error instanceof BinferenceError ? error.code : "unexpected";
      logger.warn("engine.push_failed", { errorCode: code });
    }
    telegram?.relay(push);
  };
  const engine = createEngine({
    stores: parts.stores,
    positions: options.positions,
    custody: parts.custody,
    prices: parts.prices,
    wallets: options.wallets,
    host,
    simulator: options.simulator,
    executor: options.executor,
    paperBalances: options.paperBalances,
    isLocked: options.isLocked ?? (() => false),
    chains,
    clock,
    ids: createIdSource({ clock, random }),
    random,
    publish,
  });
  const telegram = joinTelegram(parts, options, engine);
  const server = createProtocolServer({
    ...(options.http === undefined ? {} : { http: options.http }),
    auth: { access: parts.stores.access },
    idempotency: parts.stores.idempotency,
    handlers: { ...engine.handlers, ...options.handlers },
    engine: {
      version: options.version,
      state: options.state ?? (() => "ready"),
      owner: () => options.owner,
    },
    clock,
    random,
    logger: logger.child("server"),
  });
  return { engine, server, publish, ...(telegram === undefined ? {} : { telegram }) };
}
