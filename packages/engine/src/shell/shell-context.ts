import type { Clock, IdSource, Logger } from "@binference/core";
import type { ChatSurface, ShellRequestOutcome } from "@binference/protocol";
import { type ChatRelayOptions, chatTopic } from "../chat/chat-relay-parts.js";
import type { AllowedParts } from "./allowed-handlers.js";
import type { CommandRunner, ShellStore } from "./ports.js";
import type { ShellJobs } from "./shell-jobs.js";
import type { ShellSettings } from "./shell-policy.js";
import type { OpenShellRequest, ShellRequests } from "./shell-requests.js";

/** What the shell wakes an agent through: the chat's inbox, its agents and its pushes. */
export type ShellWakeParts = Pick<
  ChatRelayOptions,
  "agents" | "agentInbox" | "ids" | "clock" | "publish" | "intentView"
>;

/** A message that starts the agent's next turn: binference's words and the turn's surface. */
export interface ShellWake {
  readonly agent: string;
  readonly text: string;
  readonly surface: ChatSurface;
  /** The words carry a command's output, so the turn they start is marked. */
  readonly outsideContent: boolean;
}

/**
 * Everything the shell's handlers share (decisions 0378 and 0409): the runner and the settings as
 * they are now, the jobs and the open requests in memory, the rows the store keeps, and the ways
 * to push, wake an agent and keep allowed commands.
 */
export interface ShellContext {
  readonly runner?: CommandRunner;
  readonly settings: () => ShellSettings;
  readonly jobs: ShellJobs;
  readonly requests: ShellRequests;
  readonly store: ShellStore;
  readonly wakeParts: ShellWakeParts;
  readonly allowed: AllowedParts;
  readonly clock: Clock;
  readonly ids: IdSource;
  readonly logger?: Logger;
  /** Each job a call left running, with its turn's surface and the write that keeps its row. */
  readonly left: Map<string, { readonly surface: ChatSurface; readonly written: Promise<void> }>;
}

/** Pushes how a request ended on its agent's chat topic, as `chat/shellRequestClosed`. */
export function pushClosed(
  context: ShellContext,
  request: OpenShellRequest,
  outcome: ShellRequestOutcome,
): void {
  const { agent, request: id } = request.view;
  context.wakeParts.publish({
    topic: chatTopic(agent),
    kind: "chat/shellRequestClosed",
    data: { agent, request: id, outcome },
  });
}
