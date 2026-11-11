import type { CommandWall } from "../ports.js";

/**
 * The wall of the Docker image (decision 0412): commands run as `binference-shell`, an OS user
 * that cannot cross the state folder, so the kernel keeps them from binference's own files and a
 * launch runs as it is.
 */
export const osUserWall: CommandWall = {
  state: { kind: "held", by: "os_user" },
  wrap: (launch) => launch,
};
