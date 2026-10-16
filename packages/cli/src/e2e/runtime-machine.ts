import type { ProtocolClient } from "@binference/client";
import { type Clock, createSecret, type JsonValue, type Logger } from "@binference/core";
import { createSeededRandom } from "@binference/core/testing";
import type { EngineStores } from "@binference/engine";
import type { RunningTurns } from "@binference/engine/chat";
import { createMemoryCardCopyStore, createMemoryOwnerStore } from "@binference/engine/testing";
import type { ClientKind, PushFrame } from "@binference/protocol";
import type { RuntimeModelPrice } from "@binference/runtime";
import {
  fixtureSettings,
  type InProcessRuntime,
  type ScriptedReply,
  startInProcessRuntime,
} from "@binference/runtime/testing";
import { createTelegramImages } from "@binference/telegram";
import { createFakeBotApi, type FakeBotApi, fakeBotToken } from "@binference/telegram/testing";
import { Api } from "grammy";
import {
  createRuntimeSupervisor,
  type RuntimeSupervisor,
} from "../agent-runtime/runtime-supervisor.js";
import { makeRuntimeToken } from "../agent-runtime/runtime-token.js";
import type { TelegramParts } from "../compose/compose-telegram.js";

/** The owner's numeric Telegram id, paired with the test bot. */
export const ownerId = 7_012_345_678;

const live = (): { readonly signal: AbortSignal } => ({ signal: AbortSignal.timeout(10_000) });

/** The pushes of an agent's chat topic, and waits on them. */
export interface ChatWatch {
  readonly pushes: readonly PushFrame[];
  /** Resolves once the agent's nth turn ended. */
  turnsEnded(count: number): Promise<void>;
  /** Resolves once the topic carried `count` pushes of the kind. */
  pushed(kind: string, count: number): Promise<void>;
}

/** Watches the agent's chat topic through the client, from now on. */
export function watchChat(client: ProtocolClient, agent: string): ChatWatch {
  const pushes: PushFrame[] = [];
  const waiting: { readonly kind: string; readonly count: number; readonly resolve: () => void }[] =
    [];
  const seen = (kind: string): number => pushes.filter((push) => push.kind === kind).length;
  client.subscribe(`chat:${agent}`, {
    onPush: (push) => {
      pushes.push(push);
      waiting.filter((wait) => seen(wait.kind) >= wait.count).forEach((wait) => wait.resolve());
    },
    refetch: async () => Promise.resolve(),
  });
  const pushed = async (kind: string, count: number): Promise<void> =>
    new Promise((resolve) => {
      waiting.push({ kind, count, resolve });
      if (seen(kind) >= count) {
        resolve();
      }
    });
  return { pushes, pushed, turnsEnded: async (count) => pushed("chat/turnEnded", count) };
}

/** The owner's bot on the synthetic Bot API, paired with the owner. */
export async function ownerBot(): Promise<{
  readonly botApi: FakeBotApi;
  readonly telegram: TelegramParts;
}> {
  const botApi = createFakeBotApi();
  const owners = createMemoryOwnerStore();
  await owners.bind({ userId: ownerId, pairedAtMs: 1 }, live());
  const api = new Api(fakeBotToken, { fetch: botApi.fetch });
  const botToken = createSecret(fakeBotToken);
  const telegram = {
    api,
    owners,
    copies: createMemoryCardCopyStore(),
    botToken,
    images: createTelegramImages({ api, download: botApi.download, token: botToken }),
  };
  return { botApi, telegram };
}

/** A text the owner sends in their private chat, as Telegram delivers it. */
export function ownerText(text: string, updateId = 1): JsonValue {
  return {
    update_id: updateId,
    message: {
      message_id: 6 + updateId,
      date: 1_760_000_000,
      chat: { id: ownerId, type: "private" },
      from: { id: ownerId, is_bot: false, first_name: "Owner" },
      text,
    },
  };
}

/** A photo the owner sends in their private chat, with a caption, as Telegram delivers it. */
export function ownerPhoto(
  photo: { readonly fileId: string; readonly caption: string; readonly sizeBytes?: number },
  updateId = 1,
): JsonValue {
  const size = photo.sizeBytes === undefined ? {} : { file_size: photo.sizeBytes };
  return {
    update_id: updateId,
    message: {
      message_id: 6 + updateId,
      date: 1_760_000_000,
      chat: { id: ownerId, type: "private" },
      from: { id: ownerId, is_bot: false, first_name: "Owner" },
      caption: photo.caption,
      photo: [{ file_id: photo.fileId, file_unique_id: "u1", width: 800, height: 600, ...size }],
    },
  };
}

/** The Confirm button of the one card in the owner's chat. */
export function confirmOf(botApi: FakeBotApi): {
  readonly data: string;
  readonly messageId: number;
} {
  const card = botApi.messages().find((message) => message.buttons.length > 0);
  const data = card?.buttons[0]?.[0]?.data ?? "";
  return { data, messageId: card?.messageId ?? 0 };
}

/** The engine a runtime signs in to: its server, the tokens it keeps and how a client connects. */
export interface RuntimeEngine {
  connect(secret: string, kind: ClientKind): Promise<ProtocolClient>;
  readonly stores: Pick<EngineStores, "access">;
  readonly server: { endSessions(token: string, code: "auth.revoked"): void };
  readonly clock: Clock;
  readonly logger: Logger;
}

/** What the runtime's model answers, across every turn, and what each call costs. */
export interface RuntimeScript {
  readonly replies: readonly ScriptedReply[];
  readonly price?: RuntimeModelPrice;
  /** The model takes images as input. */
  readonly readsImages?: boolean;
  /** The vision model's answers; no vision model when absent. */
  readonly visionReplies?: readonly ScriptedReply[];
}

/**
 * Starts the agent runtime as the engine starts the real one, with a token of its own, in this
 * process on the scripted model: the supervisor that keeps it, begun. The caller stops it.
 */
export function superviseRuntime(
  engine: RuntimeEngine,
  parts: {
    readonly turns: RunningTurns;
    readonly script: RuntimeScript;
    /** Each runtime the supervisor started, so a test reads what its models were asked. */
    readonly started?: InProcessRuntime[];
  },
): RuntimeSupervisor {
  const { access } = engine.stores;
  const { replies, price, readsImages, visionReplies } = parts.script;
  const supervisor = createRuntimeSupervisor({
    start: async () => {
      const runtime = startInProcessRuntime({
        replies,
        ...(price === undefined ? {} : { price }),
        ...(readsImages === undefined ? {} : { readsImages }),
        ...(visionReplies === undefined ? {} : { visionReplies }),
        signIn: async (start) => engine.connect(start.token, "runtime"),
      });
      parts.started?.push(runtime);
      return Promise.resolve(runtime);
    },
    makeToken: async (signal) =>
      makeRuntimeToken({ access, clock: engine.clock, random: createSeededRandom(21) }, signal),
    startLine: {
      endpoint: "skeleton",
      paths: { agentDb: "agent.sqlite", workspace: "workspace" },
      settings: fixtureSettings,
    },
    turns: parts.turns,
    onRevoked: (tokens) =>
      tokens.forEach((token) => engine.server.endSessions(token, "auth.revoked")),
    clock: engine.clock,
    logger: engine.logger,
  });
  supervisor.begin();
  return supervisor;
}
