import type { Id } from "@binference/core";
import type { AgentInboxStore } from "./ports.js";

/**
 * Holds the new agent inbox messages of agents whose chats are being deleted (decision 0415), so
 * a message stored meanwhile lands in the new chat once the deletion ended, never in the old one
 * it deletes. It keeps one entry per agent a deletion holds, which its release removes; a held
 * write waits until then or until its own call is aborted.
 */
export interface InboxHold {
  /** Holds the agents' new messages until the release this answers runs. */
  hold(agents: readonly Id<"agt">[]): () => void;
  /** Settles at once while no deletion holds the agent, else once every one that does ended. */
  passed(agent: Id<"agt">, signal: AbortSignal): Promise<void>;
  /** Whether a deletion holds the agent's new messages now. */
  isHeld(agent: Id<"agt">): boolean;
}

// Settles once `held` settles, or rejects with the signal's reason once it is aborted.
async function until(held: Promise<void>, signal: AbortSignal): Promise<void> {
  signal.throwIfAborted();
  const cut = { off: (): void => undefined };
  const aborted = new Promise<never>((_resolve, reject) => {
    const onAbort = (): void => {
      reject(signal.reason);
    };
    signal.addEventListener("abort", onAbort, { once: true });
    cut.off = () => {
      signal.removeEventListener("abort", onAbort);
    };
  });
  try {
    await Promise.race([held, aborted]);
  } finally {
    cut.off();
  }
}

/** Creates the engine's {@link InboxHold}, holding no agent. */
export function createInboxHold(): InboxHold {
  const held = new Map<Id<"agt">, Promise<void>>();
  return {
    hold(agents) {
      const release = { run: (): void => undefined };
      const ended = new Promise<void>((resolve) => {
        release.run = resolve;
      });
      agents.forEach((agent) => held.set(agent, ended));
      return () => {
        agents.filter((agent) => held.get(agent) === ended).forEach((agent) => held.delete(agent));
        release.run();
      };
    },
    async passed(agent, signal) {
      // A second deletion of the agent may hold it as the first lets go: wait for each in turn.
      for (let wait = held.get(agent); wait !== undefined; wait = held.get(agent)) {
        // oxlint-disable-next-line eslint/no-await-in-loop -- each hold ends before the next is read
        await until(wait, signal);
      }
    },
    isHeld: (agent) => held.has(agent),
  };
}

/**
 * A new hold, and the agent inbox whose every new message first waits while it holds its agent,
 * so no writer of the relay stores one into the chat being deleted.
 */
export function heldInboxOf(store: AgentInboxStore): {
  readonly agentInbox: AgentInboxStore;
  readonly inboxHold: InboxHold;
} {
  const inboxHold = createInboxHold();
  const agentInbox: AgentInboxStore = {
    ...store,
    async add(draft, options) {
      await inboxHold.passed(draft.agentId, options.signal);
      return store.add(draft, options);
    },
  };
  return { agentInbox, inboxHold };
}
