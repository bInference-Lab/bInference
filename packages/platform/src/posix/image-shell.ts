import { rm } from "node:fs/promises";
import type { Clock } from "@binference/core";
import { osUserWall } from "./os-user-wall.js";
import { createPosixShellLauncher } from "./posix-shell-launcher.js";
import { type ServedShellLauncher, serveShellLauncher } from "./serve-shell-launcher.js";

/**
 * Where the Docker image keeps the agent's shell (decision 0412), on the state volume beside the
 * state folder and the workspace: the shell launcher's socket in `shell/run/`, which only the
 * engine's group opens, and the home of the user every command runs as, `binference-shell`, whose
 * group the engine's user is a member of and the workspace belongs to.
 */
export const imageShellLayout = {
  socket: "/var/lib/binference/.binference/shell/run/launcher.sock",
  home: "/var/lib/binference/.binference/shell/home",
  user: "binference-shell",
  group: 10_003,
} as const;

/**
 * Serves the Docker image's shell launcher (decision 0412) at the image's socket, as
 * `serveShellLauncher` does: bash without its startup files, as the user this process runs as,
 * `binference-shell`, whose home and name each command gets. A socket a launcher before it left
 * there is removed first; the folder is that user's own. The image's program imports it alone
 * through `@binference/platform/image-shell`, so its bundle holds nothing else of this package.
 */
export async function serveImageShell(
  clock: Clock,
  signal: AbortSignal,
): Promise<ServedShellLauncher> {
  const { socket, home, user } = imageShellLayout;
  await rm(socket, { force: true });
  const launcher = createPosixShellLauncher(osUserWall, { loginShell: "/bin/bash", clock });
  const own = { HOME: home, USER: user, LOGNAME: user };
  return serveShellLauncher({ socket, launcher, own }, signal);
}
