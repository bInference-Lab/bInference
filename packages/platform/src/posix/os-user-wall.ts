import type { CommandWall, CommandWallState } from "../ports.js";

const held: CommandWallState = { kind: "held", by: "os_user" };

/**
 * The wall of the Docker image (decision 0412): commands run as `binference-shell`, an OS user
 * that cannot cross the state folder, so the kernel keeps them from binference's own files and a
 * launch runs as it is.
 */
export const osUserWall: CommandWall = {
  state: held,
  check: async () => Promise.resolve(held),
  wrap: (launch) => launch,
};
