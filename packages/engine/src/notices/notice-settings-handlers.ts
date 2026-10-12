import { BinferenceError, type Clock, err, ok, type Result } from "@binference/core";
import type { ProtocolErrorCode, ResultOf } from "@binference/protocol";
import { authorOf, journalConfigChange } from "../audit/journal-config-change.js";
import { activeAgent } from "../operations/active-agent.js";
import type { EngineCall, EngineHandler } from "../operations/engine-call.js";
import type { AgentStore, ConfigJournal } from "../ports.js";
import type { PublishPush } from "../pushes/engine-push.js";
import {
  mutableNoticeKinds,
  type NoticeSettings,
  noticeSettingsDocument,
  noticeSettingsOf,
  noticeSettingsSchema,
} from "./notice-settings.js";

/** The handlers of an agent's notice settings (protocol spec, section 7.1; decision 0185). */
export interface NoticeSettingsHandlers {
  readonly "notice/getSettings": EngineHandler<"notice/getSettings">;
  readonly "notice/setSettings": EngineHandler<"notice/setSettings">;
}

/** What the notice settings handlers read, write and journal through. */
export interface NoticeSettingsHandlersOptions {
  readonly agents: AgentStore;
  readonly journal: ConfigJournal;
  readonly clock: Clock;
  readonly publish: PublishPush;
}

type NoticeSettingsView = ResultOf<"notice/getSettings">;

// Another write to the agent row, such as a switch to live, makes a set read it again.
const setAttempts = 3;

function viewOf(settings: NoticeSettings): NoticeSettingsView {
  const { muted, dailySummaryTime } = settings;
  return { muted: [...muted], mutable: [...mutableNoticeKinds], dailySummaryTime };
}

async function setSettings(
  options: NoticeSettingsHandlersOptions,
  call: EngineCall<"notice/setSettings">,
  attemptsLeft: number,
): Promise<Result<NoticeSettingsView, ProtocolErrorCode>> {
  const { args, signal } = call;
  const found = await activeAgent(options.agents, args.agent, { signal });
  if (!found.ok) {
    return found;
  }
  const { agent } = found.value;
  const before = noticeSettingsOf(agent.notifications);
  const wanted = noticeSettingsSchema.safeParse({
    muted: args.muted ?? before.muted,
    dailySummaryTime: args.dailySummaryTime ?? before.dailySummaryTime,
  });
  if (!wanted.success) {
    return err("protocol.bad_args");
  }
  const after = wanted.data;
  const document = noticeSettingsDocument(after);
  const atMs = options.clock.now();
  const change = { agentId: agent.id, notifications: document, atMs };
  const set = await options.agents.setNotifications(
    { ...change, expectedVersion: agent.version },
    { signal },
  );
  if (set.ok) {
    const path = `agents.${agent.name}.notifications`;
    const journaled = { path, before: noticeSettingsDocument(before), after: document };
    await journalConfigChange(options, { author: authorOf(call.caller), atMs, ...journaled }, call);
    return ok(viewOf(after));
  }
  if (set.error === "not_found" || attemptsLeft <= 1) {
    throw new BinferenceError({
      code: "engine.agent_stale",
      message: `The row of agent ${agent.id} kept changing under the notice settings.`,
      retryable: true,
      details: { agent: agent.id },
    });
  }
  return setSettings(options, call, attemptsLeft - 1);
}

/**
 * Creates the notice settings handlers (decision 0185). `notice/getSettings` answers the kinds an
 * agent muted, the kinds it may mute and its daily summary's time. `notice/setSettings` replaces
 * the muted kinds with the ones it names, or moves the summary, or both; a kind that cannot be
 * muted, a kind named twice or a time that is not `HH:mm` is `protocol.bad_args`. Each change is
 * journaled with who made it and where, and pushed as `config/changed`.
 */
export function createNoticeSettingsHandlers(
  options: NoticeSettingsHandlersOptions,
): NoticeSettingsHandlers {
  return {
    async "notice/getSettings"({ args, signal }) {
      const found = await activeAgent(options.agents, args.agent, { signal });
      return found.ok ? ok(viewOf(noticeSettingsOf(found.value.agent.notifications))) : found;
    },
    async "notice/setSettings"(call) {
      return setSettings(options, call, setAttempts);
    },
  };
}
