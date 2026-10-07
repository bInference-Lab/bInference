import { join } from "node:path";
import type { FileAccessState, Platform } from "@binference/platform";
import { cliTokenFile } from "../compose/cli-token.js";
import type { CheckFinding, CheckLevel } from "./check-finding.js";

/** A path whose access the check reads: a file or a folder of the state folder. */
interface CheckedPath {
  readonly check: string;
  readonly path: string;
  readonly kind: "file" | "folder";
}

/** What reading the access of the state folder's paths takes. */
export interface AccessCheck {
  readonly platform: Pick<Platform, "stateFolder" | "permissions" | "access">;
  /** `check --fix`: make each path others can open, or that this system cannot read, owner-only. */
  readonly fix: boolean;
  readonly signal: AbortSignal;
}

const levels: Readonly<Record<Exclude<FileAccessState, "missing">, CheckLevel>> = {
  owner_only: "ok",
  open: "fail",
  unknown: "skip",
};

// The state folder and what the specs keep owner-only in it: config.json5, the CLI token, the
// IPC sockets and the agent's keys.
function checkedPaths(platform: AccessCheck["platform"]): readonly CheckedPath[] {
  const { stateFolder } = platform;
  const tokenFile = cliTokenFile(stateFolder);
  return [
    { check: "permissions.state_folder", path: stateFolder.root, kind: "folder" },
    { check: "permissions.config_file", path: stateFolder.configFile, kind: "file" },
    { check: "permissions.auth_folder", path: join(stateFolder.root, "auth"), kind: "folder" },
    { check: "permissions.cli_token", path: tokenFile, kind: "file" },
    { check: "permissions.run_folder", path: stateFolder.run, kind: "folder" },
    { check: "permissions.keys_folder", path: stateFolder.keys, kind: "folder" },
  ];
}

async function restrict(
  platform: AccessCheck["platform"],
  checked: CheckedPath,
  signal: AbortSignal,
): Promise<void> {
  if (checked.kind === "folder") {
    await platform.permissions.restrictFolder(checked.path, signal);
  } else {
    await platform.permissions.restrictFile(checked.path, signal);
  }
}

async function findingOf(
  options: AccessCheck,
  checked: CheckedPath,
): Promise<readonly CheckFinding[]> {
  const { platform, signal } = options;
  const { check, path } = checked;
  const before = await platform.access.read(path, signal);
  if (before === "missing") {
    return [];
  }
  if (!options.fix || before === "owner_only") {
    const problem = before === "open" ? { message: { key: "check.open", values: { path } } } : {};
    return [{ check, level: levels[before], ...problem, details: { path, access: before } }];
  }
  await restrict(platform, checked, signal);
  const after = await platform.access.read(path, signal);
  const access = after === "missing" ? before : after;
  const fixed = { key: "check.fixed", values: { path } };
  return [{ check, level: levels[access], fixed, details: { path, access, fixed: true } }];
}

/**
 * Reads who can open the state folder and the files the specs keep owner-only in it: config.json5
 * (config spec, section 2), the CLI token, the IPC sockets' folder and the agent's keys. A path
 * others can open is a problem; with `fix`, it and every path this system cannot read are
 * restricted to their owner and read again. A path that is not there is left out. Paths go one
 * at a time, outermost first, so a fix never races another on a folder and what it holds.
 */
export async function accessFindings(options: AccessCheck): Promise<readonly CheckFinding[]> {
  return checkedPaths(options.platform).reduce<Promise<readonly CheckFinding[]>>(
    async (done, checked) => [...(await done), ...(await findingOf(options, checked))],
    Promise.resolve([]),
  );
}
