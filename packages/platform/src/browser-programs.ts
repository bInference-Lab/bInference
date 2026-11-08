import { accessSync, constants, statSync } from "node:fs";

// Whether a file is at the path that this process may run.
function isProgram(path: string): boolean {
  if (statSync(path, { throwIfNoEntry: false })?.isFile() !== true) {
    return false;
  }
  try {
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/** The first of `places` that holds a program this process may run, or `undefined`. */
export function firstProgram(places: readonly string[]): string | undefined {
  return places.find(isProgram);
}
