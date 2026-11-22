import {
  readRegistryAnswer,
  registryPreflight,
  type RegistryPreflight,
} from "../../packages/cli/src/packed/registry-preflight.js";
import { runCommand } from "../run-command.mjs";

/** The release a dry run checks against npm. */
export interface RegistryAsk {
  readonly version: string;
  /** The tag exists and names HEAD, as on the release workflow's runs. */
  readonly tagged: boolean;
  /** The packages the release publishes. */
  readonly packages: readonly string[];
}

// One retry and 15 seconds a request, so a registry that does not answer costs the dry run under a
// minute before it goes on with a warning.
const viewFlags = ["--json", "--loglevel=silent", "--fetch-retries=1", "--fetch-timeout=15000"];

/**
 * Reads each package on npm with `npm view <name> versions dist-tags`, then checks the release
 * against what npm holds (`registryPreflight`). Publishes nothing and needs no login.
 */
export function readRegistryPreflight(root: string, ask: RegistryAsk): RegistryPreflight {
  const packages = ask.packages.map((name) => {
    const view = ["npm", "view", name, "versions", "dist-tags", ...viewFlags];
    const { status, output } = runCommand(view, { cwd: root });
    return { name, answer: readRegistryAnswer(status, output) };
  });
  return registryPreflight({ version: ask.version, tagged: ask.tagged }, packages);
}
