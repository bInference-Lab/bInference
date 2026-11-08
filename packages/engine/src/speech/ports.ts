import type { Result } from "@binference/core";

/**
 * Why the machine's own voice spoke nothing (decision 0405): this OS has no voice binference
 * drives, or the voice program failed or ran past its time limit.
 */
export type LocalVoiceRefusal = "unavailable" | "failed";

/**
 * Speaks words with the voice of the engine's machine, for the agent's `speak` when
 * `models.speech` is `local` (decision 0405): the words as audio of a format a voice note takes,
 * such as M4A. It runs the OS's own programs with argument arrays, never a shell, each under a
 * time limit, and leaves no file behind; it rejects with the signal's reason once the signal
 * aborts. The composition root builds it in the CLI over the platform's program runner.
 */
export interface LocalVoice {
  speak(
    request: { readonly text: string; readonly voice?: string },
    call: { readonly signal: AbortSignal },
  ): Promise<Result<Uint8Array, LocalVoiceRefusal>>;
}
