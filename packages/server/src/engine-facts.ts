import type { EngineState, OwnerInfo } from "@binference/protocol";

/** What the server tells each client about the engine, read when it is needed. */
export interface EngineFacts {
  /** The engine's release, for `ready`. */
  readonly version: string;
  /**
   * Whether the engine serves calls yet. While `starting`, `/health` answers 503 and every call
   * but `engine/status`, `push/subscribe` and `push/unsubscribe` fails with `engine.starting`.
   */
  readonly state: () => EngineState;
  /** The owner's language and time zone, for `ready`. */
  readonly owner: () => OwnerInfo;
}
