import { dirname } from "node:path";
import type { CliHost } from "../program/cli-host.js";
import { npmPrefixOf } from "../uninstall/remove-program.js";

/**
 * How this binference was installed (decision 0356): by npm into a global prefix, as every install
 * path but the image does; as the Docker image, which never updates in place; or in another
 * folder, such as a checkout, which `update` leaves as it is.
 */
export type InstalledProgram =
  | { readonly kind: "npm"; readonly prefix: string }
  | { readonly kind: "image" }
  | { readonly kind: "other"; readonly folder: string };

// The image's user, which its Dockerfile sets and no other install does.
const imageVariable = "BINFERENCE_IMAGE_USER";

/** How the program this process runs from was installed, from its script and environment. */
export function installedProgramOf(host: Pick<CliHost, "entry" | "env">): InstalledProgram {
  if (host.env[imageVariable] !== undefined) {
    return { kind: "image" };
  }
  const prefix = npmPrefixOf(host.entry.script);
  return prefix === undefined
    ? { kind: "other", folder: dirname(dirname(host.entry.script)) }
    : { kind: "npm", prefix };
}
