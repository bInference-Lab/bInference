import { BinferenceError } from "@binference/core";
import type { CommandLaunch } from "../command-launch.js";
import type { CommandWall, CommandWallState } from "../ports.js";

/**
 * The Windows command wall: none in v1. Windows has no built-in mechanism binference uses to deny
 * a command the walled paths while leaving the rest of the machine reachable, so it answers `none`
 * and the shell is refused. The Docker image walls the shell host by running it as its own OS user
 * instead, so this adapter serves a Windows machine, not the image.
 */
export function createWin32CommandWall(): CommandWall {
  const reason = "Windows has no command wall yet, so the agent's shell is off on Windows.";
  const state: CommandWallState = { kind: "none", cause: "missing", reason };
  return {
    state,
    check: async () => Promise.resolve(state),
    wrap(_launch: CommandLaunch): CommandLaunch {
      throw new BinferenceError({ code: "platform.no_wall", message: reason });
    },
  };
}
