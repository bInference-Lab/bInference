import process from "node:process";
import { runCommand } from "./run-command.mjs";

// CI sets BASE_REF to the pull request's base; locally the remote master, else the local one.
function baseRef(root: string): string {
  const fromEnv = process.env["BASE_REF"];
  if (fromEnv !== undefined && fromEnv.length > 0) {
    return fromEnv;
  }
  const remote = runCommand(["git", "rev-parse", "--verify", "-q", "origin/master"], { cwd: root });
  return remote.status === 0 ? "origin/master" : "master";
}

/**
 * A file as it stood at the merge base of HEAD and the base branch, or undefined when the base
 * cannot be found or did not have the file.
 */
export function readAtBase(root: string, path: string): string | undefined {
  const mergeBase = runCommand(["git", "merge-base", "HEAD", baseRef(root)], { cwd: root });
  if (mergeBase.status !== 0) {
    return undefined;
  }
  const base = mergeBase.output.trim().split("\n")[0] ?? "";
  const before = runCommand(["git", "show", `${base}:${path}`], { cwd: root });
  return before.status === 0 ? before.output : undefined;
}
