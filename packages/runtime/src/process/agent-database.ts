import type { ChatQueueStore, SessionStore, TranscriptStore, WriterFence } from "@binference/store";

/** `agent.sqlite`, open and migrated, with the stores the runtime writes through. */
export interface AgentDatabase {
  readonly fence: WriterFence;
  readonly sessions: SessionStore;
  readonly transcript: TranscriptStore;
  readonly queue: ChatQueueStore;
  /** The schema version after the migrations, which `ready` reports. */
  readonly schemaVersion: number;
  /** Closes its connections; the runtime's last step before it exits. */
  close(): Promise<void>;
}
