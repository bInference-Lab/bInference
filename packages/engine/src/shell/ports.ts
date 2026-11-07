import type { Result } from "@binference/core";
import type { CommandRequest, RunningCommand } from "./command-request.js";

/**
 * Runs the agent's commands in the owner's shell behind the command wall (decision 0378). The
 * composition root builds it from the platform's shell launcher, with the environment cleared of
 * binference's secrets and the owner's home folder as the default folder.
 */
export interface CommandRunner {
  /**
   * Starts a command and hands its output to `onOutput` as it comes. Answers `no_wall` when this
   * machine cannot keep it from binference's own folder, and `folder_missing` when its folder
   * does not exist; a command then never starts.
   */
  start(
    request: CommandRequest,
    onOutput: (text: string) => void,
  ): Result<RunningCommand, "no_wall" | "folder_missing">;
  /** The text with seed phrases and private key blocks masked, before the model reads it. */
  mask(text: string): string;
}
