import type { Amount, ChainRegistry, TxSimulator, Venue } from "@binference/chain";
import {
  BinferenceError,
  type Clock,
  createIdSource,
  type IdSource,
  type Logger,
  type Random,
} from "@binference/core";
import {
  createEngine,
  createVenueHost,
  type Engine,
  type EngineOptions,
  type EnginePush,
  type Executor,
  type PositionStore,
  type RiskCacheStore,
  type Simulator,
  type VenueHost,
  type WalletFactsSource,
} from "@binference/engine";
import { createDevicePairing, createLockoutNotices } from "@binference/engine/access";
import { createRunningTurns, markRuntimeTurns, type RunningTurns } from "@binference/engine/chat";
import { isNoticeMutedFor } from "@binference/engine/notices";
import { createRiskCheck, type RiskCheck } from "@binference/engine/risk";
import type { EngineHandlerTable } from "@binference/engine/surfaces";
import type { EngineState, OwnerInfo } from "@binference/protocol";
import {
  type ConsoleFiles,
  createProtocolServer,
  type HttpListenOptions,
  type MiniAppAuth,
  type ProtocolServer,
  telegramCredentialOf,
} from "@binference/server";
import type { WebPushRelay } from "../web-push/web-push-relay.js";
import { accessHandlersOf } from "./access-handlers.js";
import { type ComposedTelegram, composeTelegram, type TelegramParts } from "./compose-telegram.js";
import { composeWebPush, type WebPushParts } from "./compose-web-push.js";
import { consoleOriginCell } from "./console-origin.js";
import { createNoticeLog, type NoticeLog } from "./notice-log.js";
import type { ProfileParts } from "./profile-parts.js";

/**
 * The profile parts the engine runs on: custody with its ceilings, wallet maker, exporter and
 * signer revoker, stores, prices, risk sources and market reads.
 */
export type EngineParts = Pick<
  ProfileParts,
  | "custody"
  | "ceilings"
  | "walletMaker"
  | "exporter"
  | "revoker"
  | "stores"
  | "prices"
  | "riskSources"
  | "marketReads"
>;

/** What the token risk step runs on besides the venue host. */
interface RiskParts {
  readonly cache: RiskCacheStore;
  /** How long a source's report holds: config's `risk.cacheTtlSec`, in milliseconds. */
  readonly cacheTtlMs: number;
  /** Runs the round trip's legs, and a rescue's sends, unsent on the chain's latest state. */
  readonly simulator: TxSimulator;
}

/** What the engine and its protocol server are built from besides the profile parts. */
export interface ComposeEngineOptions {
  readonly chains: ChainRegistry;
  /** Every venue the engine may use; the venue host checks their declarations at once. */
  readonly venues: readonly Venue[];
  readonly simulator: Simulator;
  readonly risk: RiskParts;
  readonly wallets: WalletFactsSource;
  /** Takes each confirmed live intent onto its wallet's queue. */
  readonly executor: Executor;
  /** Executions, arrivals and positions, the paper portfolio's too. */
  readonly positions: PositionStore;
  /** What a paper portfolio starts with: config's `defaults.paper.balances`, resolved to assets. */
  readonly paperBalances: readonly Amount[];
  /** The engine's release, for `ready`. */
  readonly version: string;
  /** The owner's language and time zone now, read at each new connection. */
  readonly owner: () => OwnerInfo;
  /** The HTTP listener; without it the server serves IPC connections only. */
  readonly http?: HttpListenOptions;
  /** The console's built files, which the HTTP listener serves at `/` and `/mini`. */
  readonly consoleFiles?: ConsoleFiles;
  /** Whether the engine serves calls yet; `ready` when left out. */
  readonly state?: () => EngineState;
  /**
   * Whether the unlock mode has not given the engine the agent key yet, so it signs nothing;
   * never locked when left out.
   */
  readonly isLocked?: () => boolean;
  /** Whether the price watchers can price a token now, which a price order needs (decision 0194). */
  readonly canPrice: EngineOptions["canPrice"];
  /** Whether live auto orders fill; off when absent (decision 0195). */
  readonly liveOrderFills?: boolean;
  /** Reads what a token the registry does not list answers on chain, for its cards. */
  readonly readTokenFacts: EngineOptions["readTokenFacts"];
  /** Each agent's workspace files. */
  readonly workspace: EngineOptions["workspace"];
  /** Handlers of operations the composition root answers, such as `engine/status`. */
  readonly handlers?: EngineHandlerTable;
  /**
   * The agent runtime's running turns, whose outside-content marks its proposals take; with none,
   * every proposal of a client with `agent` counts as outside content.
   */
  readonly turns?: RunningTurns;
  /** The owner's bot; without it the engine shows no card in Telegram. */
  readonly telegram?: TelegramParts;
  /**
   * Browser push (decision 0158): the VAPID key, the outbound HTTP the messages go through and
   * the endpoint check; without it the engine serves no browser push operation and sends no
   * browser a card.
   */
  readonly webPush?: WebPushParts;
  /**
   * The handlers only the owner's bot runs: the `config/change` that sets `owner.locale`, the one
   * setting the owner's chat changes (decision 0134). The protocol server never serves them.
   */
  readonly ownerChat?: Pick<EngineHandlerTable, "config/change">;
  readonly clock: Clock;
  readonly random: Random;
  readonly logger: Logger;
}

/** The engine with the protocol server that serves its operations and pushes. */
export interface ComposedEngine {
  readonly engine: Engine;
  readonly server: ProtocolServer;
  /**
   * Where the engine's pushes go: the server, and the owner's bot when there is one. Every notice
   * is stored on its way (decision 0133).
   */
  readonly publish: (push: EnginePush) => void;
  /** The one write path of the notices; `idle` resolves once every notice so far is stored. */
  readonly notices: NoticeLog;
  /** The owner's bot joined to the engine, when the options name one. */
  readonly telegram?: ComposedTelegram;
  /** The line of card pushes to the owner's browsers, when the options name browser push. */
  readonly webPush?: WebPushRelay;
}

// One quote or build that takes longer counts as a venue that is down (spec 6, section 3).
const venueCallTimeoutMs = 5_000;
// A risk source that takes longer counts as down, as a venue does: GoPlus and honeypot.is each
// answered within half a second when measured.
const riskSourceTimeoutMs = 5_000;

// The owner's bot, when the options name one, answers its presses and fast commands through the
// engine.
function joinTelegram(
  parts: EngineParts,
  options: ComposeEngineOptions,
  engine: {
    readonly answer: Engine["answer"];
    readonly venues: VenueHost;
    readonly handlers: EngineHandlerTable;
    readonly notices: NoticeLog;
    readonly server: () => ProtocolServer;
  },
): ComposedTelegram | undefined {
  const { telegram, owner, chains, clock, random, logger } = options;
  return telegram === undefined
    ? undefined
    : composeTelegram(telegram, {
        stores: parts.stores,
        answer: engine.answer,
        handlers: { ...engine.handlers, ...options.ownerChat },
        chains,
        venues: engine.venues,
        owner,
        stored: async () => engine.notices.idle(),
        // The replaced owner's Mini App connections end at once, as a revoked device's do.
        ownerReplaced: (userId) =>
          engine.server().endSessions(telegramCredentialOf(userId), "auth.revoked"),
        clock,
        random,
        logger: logger.child("telegram"),
        ...(options.isLocked === undefined ? {} : { isLocked: options.isLocked }),
      });
}

// The venue host over the options' venues, and the risk check that asks the profile's sources and
// builds its round trips there.
function tradingOf(
  parts: EngineParts,
  options: ComposeEngineOptions,
): { readonly host: VenueHost; readonly risk: RiskCheck } {
  const { clock, random, chains } = options;
  const host = createVenueHost({
    venues: options.venues,
    chains,
    clock,
    callTimeoutMs: venueCallTimeoutMs,
  });
  const risk = createRiskCheck({
    ...options.risk,
    sources: parts.riskSources,
    sourceTimeoutMs: riskSourceTimeoutMs,
    host,
    chains,
    clock,
    random,
  });
  return { host, risk };
}

// The custody ports the engine takes: signing, ceilings, new wallets and, where custody gives
// them, the sealed export and the signer removal.
function custodyPartsOf(parts: EngineParts) {
  const { custody, ceilings, walletMaker, exporter, revoker } = parts;
  return {
    custody,
    ceilings,
    walletMaker,
    ...(exporter === undefined ? {} : { exporter }),
    ...(revoker === undefined ? {} : { revoker }),
  };
}

/** What the server is built from besides the profile parts and the options. */
interface ServerParts {
  readonly handlers: EngineHandlerTable;
  readonly publish: (push: EnginePush) => void;
  readonly ids: IdSource;
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

// The protocol server over the handlers: sign-ins through the access store and the owner's bot,
// idempotent writes, device pairing, the console, and the owner's notice of each lockout.
function serverOf(
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

// The engine on the profile parts, its venue host and risk check, publishing through `publish`.
function engineOf(
  parts: EngineParts,
  options: ComposeEngineOptions,
  given: {
    readonly ids: IdSource;
    readonly publish: (push: EnginePush) => void;
    readonly turns: RunningTurns;
    readonly trading: { readonly host: VenueHost; readonly risk: RiskCheck };
  },
): Engine {
  const { host, risk } = given.trading;
  return createEngine({
    stores: parts.stores,
    positions: options.positions,
    ...custodyPartsOf(parts),
    prices: parts.prices,
    marketReads: parts.marketReads,
    wallets: options.wallets,
    host,
    risk,
    simulator: options.simulator,
    chainSimulator: options.risk.simulator,
    executor: options.executor,
    paperBalances: options.paperBalances,
    isLocked: options.isLocked ?? (() => false),
    canPrice: options.canPrice,
    ...(options.liveOrderFills === true ? { liveOrderFills: true } : {}),
    readTokenFacts: options.readTokenFacts,
    workspace: options.workspace,
    chains: options.chains,
    clock: options.clock,
    ids: given.ids,
    random: options.random,
    publish: given.publish,
    turns: given.turns,
    ownerTimeZone: () => options.owner().timezone,
    ...(options.telegram?.images === undefined ? {} : { botImages: options.telegram.images }),
  });
}

// The one write path of the notices: a delivery for the owner's bot when there is one, none for a
// kind the owner muted (decision 0185).
function noticeLogOf(parts: EngineParts, options: ComposeEngineOptions, ids: IdSource): NoticeLog {
  const { agents, notices } = parts.stores;
  return createNoticeLog({
    store: notices,
    surfaces: options.telegram === undefined ? [] : ["telegram"],
    isMuted: async (notice, call) => isNoticeMutedFor(agents, notice, call),
    ids,
    clock: options.clock,
    logger: options.logger,
  });
}

/**
 * Wires the engine and its protocol server on the profile parts both profiles fill: the server
 * signs callers in through the access store, keeps each write's result under its idempotency key
 * and routes calls to the engine's handlers; the engine's pushes reach the server, which numbers
 * them per topic. Every notice is stored first, with a delivery queued for the owner's bot when
 * there is one. A push that fails is logged and never stops the money path. With the owner's bot,
 * card pushes also reach Telegram, and notices go there from the outbox once the bot starts; with
 * browser push, they also reach the owner's browsers.
 */
export function composeEngine(parts: EngineParts, options: ComposeEngineOptions): ComposedEngine {
  const { clock, random, logger } = options;
  const ids = createIdSource({ clock, random });
  const webPush = composeWebPush(parts.stores.access, options);
  const notices = noticeLogOf(parts, options, ids);
  const publish = (push: EnginePush): void => {
    const stamped = notices.take(push);
    try {
      server.publish(stamped);
    } catch (error) {
      const code = error instanceof BinferenceError ? error.code : "unexpected";
      logger.warn("engine.push_failed", { errorCode: code });
    }
    telegram?.relay(stamped);
    webPush.relay?.relay(stamped);
  };
  // One record of running turns: the relay starts and ends them, and proposals take their marks.
  const turns = options.turns ?? createRunningTurns();
  const trading = tradingOf(parts, options);
  const engine = engineOf(parts, options, { ids, publish, turns, trading });
  const origin = consoleOriginCell();
  const table: EngineHandlerTable = {
    ...engine.handlers,
    ...accessHandlersOf({ ...options, stores: parts.stores, ids, origin, server: () => server }),
    ...webPush.handlers,
    ...options.handlers,
  };
  const handlers = markRuntimeTurns(table, turns);
  const telegram = joinTelegram(parts, options, {
    answer: engine.answer,
    venues: trading.host,
    handlers,
    notices,
    server: () => server,
  });
  const server = origin.watch(serverOf(parts, options, { handlers, publish, ids }));
  return {
    engine,
    server,
    publish,
    notices,
    ...(telegram === undefined ? {} : { telegram }),
    ...(webPush.relay === undefined ? {} : { webPush: webPush.relay }),
  };
}
