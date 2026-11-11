import { err, type JsonValue, ok } from "@binference/core";
import { createMemoryLogger } from "@binference/core/testing";
import { createMemoryEngineStores, testAgent, testAgentDraft } from "@binference/engine/testing";
import { protocolIdSchema, type ShellRequestView } from "@binference/protocol";
import { Api } from "grammy";
import { createFakeBotApi, type FakeBotApi, fakeBotToken } from "../testing/fake-bot-api.js";
import { ownerId } from "../testing/update-fixtures.js";
import { chatUpdateSchema } from "../updates/chat-update.schema.js";
import {
  createTelegramShellRequests,
  type ShellPress,
  type TelegramShellRequests,
} from "./create-telegram-shell-requests.js";

const live = { signal: new AbortController().signal };

/** A shell request as the engine pushes it, in the project folder, Always allow offered. */
export const testShellRequest: ShellRequestView = {
  request: protocolIdSchema("shellRequest").parse("shq_0190f1c2-3a4b-7c5d-8e6f-000000000001"),
  agent: testAgent,
  job: protocolIdSchema("shellJob").parse("shj_0190f1c2-3a4b-7c5d-8e6f-000000000001"),
  command: "git log -1 | head -n 3",
  folder: "/srv/project",
  reason: "unlisted",
  canAlwaysAllow: true,
  createdAt: Date.UTC(2026, 10, 11, 12),
  closesAt: Date.UTC(2026, 10, 11, 12, 10),
};

/** The push that opens a request, and the one that closes it as `outcome`. */
export function requestPush(view: ShellRequestView = testShellRequest): {
  readonly kind: string;
  readonly data: JsonValue;
} {
  return { kind: "chat/shellRequest", data: { ...view } };
}

/** The push that closes the test request as `outcome`. */
export function closedPush(outcome: string): { readonly kind: string; readonly data: JsonValue } {
  const { agent, request } = testShellRequest;
  return { kind: "chat/shellRequestClosed", data: { agent, request, outcome } };
}

/** The shell requests in a fake owner's chat, over a scripted `shell/answer`. */
export interface TestShellRequests {
  readonly botApi: FakeBotApi;
  readonly requests: TelegramShellRequests;
  /** The owner's answers `shell/answer` took, in order. */
  readonly answered: readonly ShellPress[];
  /** Presses a button of the request's message as `from`, the owner unless named. */
  press(data: string, from?: number): Promise<boolean>;
}

/**
 * Creates the shell requests of a chat in `locale`, whose `shell/answer` takes the first answer
 * and refuses later ones as `shell.request_closed`.
 */
export async function createTestShellRequests(
  locale: "en" | "zh" = "en",
): Promise<TestShellRequests> {
  const botApi = createFakeBotApi();
  const api = new Api(fakeBotToken, { fetch: botApi.fetch });
  const stores = createMemoryEngineStores();
  await stores.agents.create(testAgentDraft(), live);
  await stores.owners.bind({ userId: ownerId, pairedAtMs: 1 }, live);
  const answered: ShellPress[] = [];
  // The owner's first answer wins; a later one finds the request closed, anyone else's is refused.
  const answer = async (asked: ShellPress) => {
    if (asked.presserId !== ownerId) {
      return Promise.resolve(err("auth.scope" as const));
    }
    if (answered.length > 0) {
      return Promise.resolve(err("shell.request_closed" as const));
    }
    answered.push(asked);
    return Promise.resolve(ok({ outcome: "allowed_always" }));
  };
  const requests = createTelegramShellRequests({
    api,
    owners: stores.owners,
    answer,
    agentNames: async () => Promise.resolve(new Map([[testAgent, "main"]])),
    logger: createMemoryLogger({ subsystem: "telegram" }),
    display: () => ({ locale, timeZone: "UTC" }),
  });
  return {
    botApi,
    requests,
    answered,
    press: async (data, from = ownerId) => {
      const parsed = chatUpdateSchema.parse(botApi.press({ from, data, messageId: 1001 }));
      if (parsed.kind !== "callback") {
        throw new Error("The fixture is no button press.");
      }
      return requests.press(parsed, live);
    },
  };
}
