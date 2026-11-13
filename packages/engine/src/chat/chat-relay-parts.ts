import type { Clock, Id, IdSource, Random } from "@binference/core";
import type { ProtocolId, PushTopic } from "@binference/protocol";
import type { ModelBudget } from "../billing/model-budget.js";
import type { EngineBrowser } from "../browse/browser-handlers.js";
import type { CredentialStore } from "../credentials/ports.js";
import type { PdfReader } from "../documents/ports.js";
import type { EngineFiles } from "../files/file-handlers.js";
import type { MachineFiles } from "../files/ports.js";
import type { EngineRequests } from "../http-requests/engine-requests.js";
import type { AgentStore } from "../ports.js";
import type { PublishPush } from "../pushes/engine-push.js";
import type { InstallQuotas } from "../quotas/install-quotas.js";
import type { ScreenCapture } from "../screen/ports.js";
import type { LocalVoice } from "../speech/ports.js";
import type { AgentInboxMessage } from "./agent-inbox-record.js";
import type { RuntimeChats } from "./chat-delete.js";
import type { InboxHold } from "./inbox-hold.js";
import { inboxPushData, inboxViewOf, type IntentViewOf } from "./inbox-views.js";
import type { AgentInboxStore, OwnerImageSource, ViewImageSource, QuestionStore } from "./ports.js";
import type { RunningTurns } from "./running-turns.js";

/** What the chat relay reads, writes and pushes through. */
export interface ChatRelayOptions {
  /** The agent inbox, whose new messages wait while a deletion holds their agent. */
  readonly agentInbox: AgentInboxStore;
  /**
   * The hold of a chat deletion (decision 0415): what an agent's chats being deleted holds, and
   * which wake-ups the agent runtime asks for it drops.
   */
  readonly inboxHold: InboxHold;
  /** The agent's questions to the owner, answered with their message in one write. */
  readonly questions: QuestionStore;
  readonly agents: AgentStore;
  /** The runtime's running turns, and the token of its current start. */
  readonly turns: RunningTurns;
  /** The install's quotas: an agent's turns of the last minute bound its next (decision 0431). */
  readonly quotas?: Pick<InstallQuotas, "starting">;
  /** Each agent's daily model budget: a turn starts only while some is left. */
  readonly budget: ModelBudget;
  readonly intentView: IntentViewOf;
  readonly ids: IdSource;
  /** The random bytes of each question's button reference. */
  readonly random: Random;
  readonly clock: Clock;
  readonly publish: PublishPush;
  /** The owner's images by the names messages give them; without it none can be read. */
  readonly images?: OwnerImageSource;
  /** The images the agent views, at public addresses or in files (decision 0385); none without. */
  readonly viewImages?: ViewImageSource;
  /** The agent's files, where the images it makes are saved (decision 0392); none without. */
  readonly madeImageFiles?: Pick<MachineFiles, "read" | "write">;
  /** The agent's files with the owner's settings, which files it sends are read from (decision 0400). */
  readonly sentFiles?: EngineFiles;
  /** The machine's own voice (decision 0405); without it `speech/local` is refused. */
  readonly localVoice?: LocalVoice;
  /** The owner's screen (decision 0406); without it `screen/capture` is `screen.no_screen`. */
  readonly screen?: ScreenCapture;
  /** The agent's browser (decision 0401); without it `browser/run` is `browser.off`. */
  readonly browser?: EngineBrowser;
  /** What reads the PDFs the agent reads (decision 0402); without it `pdf/read` refuses. */
  readonly pdfReader?: PdfReader;
  /** The owner's credentials (decision 0388); without them, a request is refused. */
  readonly credentials?: CredentialStore;
  /** The agent's API calls (decision 0411); without them `http/request` is refused. */
  readonly requests?: EngineRequests;
  /**
   * Whether a community plugin is on and offers the agent tools, whose words reach every turn:
   * each turn then starts marked as outside content (decision 0350).
   */
  readonly communityPluginsOn?: () => boolean;
  /**
   * Whether an agent has a listed MCP server on, whose tools' words reach every turn of the agent:
   * each of its turns then starts marked as outside content (decision 0428).
   */
  readonly listedMcpOn?: (agent: Id<"agt">) => boolean;
  /**
   * Hears the owner's stop of an agent's chat and a freeze, of one agent or, with none named, of
   * every agent, once it landed: the agent's shell stops its commands then (decision 0409).
   */
  readonly onStop?: (agent: Id<"agt"> | undefined, by: "owner" | "freeze") => void;
  /** The agent runtime's side of a chat deletion (decision 0415); without it none runs. */
  readonly runtimeChats?: RuntimeChats;
}

/**
 * What the schedules' and alerts' wake-ups reach the chat through: the model budget, the push of
 * a stored wake-up, and the hold of a chat deletion, which a wake-up waits out (decision 0415).
 */
export type ChatWakes = Pick<ChatRelayOptions, "budget" | "inboxHold"> & {
  readonly settled: (message: AgentInboxMessage) => void;
};

/** The topic of one agent's chat. */
export function chatTopic(agent: ProtocolId<"agent">): PushTopic {
  return `chat:${agent}`;
}

/** Pushes a stored message on the `inbox` topic, as `inbox/list` would give it. */
export async function pushInbox(
  options: Pick<ChatRelayOptions, "intentView" | "publish">,
  message: AgentInboxMessage,
  signal: AbortSignal,
): Promise<void> {
  const view = await inboxViewOf(message, options.intentView, signal);
  options.publish({ topic: "inbox", kind: message.kind, data: inboxPushData(view) });
}
