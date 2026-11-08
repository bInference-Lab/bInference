import type {
  ChatQueueStore,
  GoalStore,
  HelperStore,
  NoteStore,
  SessionStore,
  TranscriptStore,
  WriterFence,
} from "@binference/store";

/** `agent.sqlite`, open and migrated, with the stores the runtime reads and writes through. */
export interface AgentDatabase {
  readonly fence: WriterFence;
  readonly sessions: SessionStore;
  readonly transcript: TranscriptStore;
  readonly queue: ChatQueueStore;
  /** The agent's helpers (decision 0403). */
  readonly helpers: HelperStore;
  /** Each chat's goal and progress note (decision 0407). */
  readonly goals: GoalStore;
  /** Each agent's notes, which the routed `notes/*` operations read and write. */
  readonly notes: NoteStore;
  /** The schema version after the migrations, which `ready` reports. */
  readonly schemaVersion: number;
  /** Closes its connections; the runtime's last step before it exits. */
  close(): Promise<void>;
}
