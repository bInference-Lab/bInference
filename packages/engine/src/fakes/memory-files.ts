import { err, ok, type Result } from "@binference/core";
import type { FileCall, ReadFile } from "../files/file-records.js";
import type { FileRefusal, MachineFiles } from "../files/ports.js";

/** Where the in-memory machine's owner lives, and binference's folder in it. */
const home = "/owner";
const state = `${home}/.binference`;
const workspace = `${state}/workspace`;

/** The in-memory machine's places, for tests that name absolute paths. */
export const memoryFilePlaces: {
  readonly home: string;
  readonly state: string;
  readonly workspace: string;
} = {
  home,
  state,
  workspace,
};

const inside = (path: string, folder: string): boolean =>
  path === folder || path.startsWith(`${folder}/`);

function absoluteOf(path: string): string {
  if (path === "~" || path.startsWith("~/")) {
    return `${home}${path.slice(1)}`;
  }
  return path.startsWith("/") ? path : `${workspace}/${path}`;
}

/**
 * Machine files in memory (decision 0386): a home folder at `/owner`, binference's folder at
 * `/owner/.binference` and its workspace inside it, holding the files given by absolute path.
 * It follows {@link MachineFiles} and passes its contract suite.
 */
export function createMemoryFiles(initial: Readonly<Record<string, string>> = {}): MachineFiles {
  const held = new Map<string, Uint8Array>(
    Object.entries(initial).map(([path, text]: readonly [string, string]) => [
      path,
      new TextEncoder().encode(text),
    ]),
  );
  const isFolder = (path: string): boolean =>
    [...held.keys()].some((each) => each.startsWith(`${path}/`));
  // The absolute path a call may use, or why not.
  const placeOf = (path: string, call: FileCall): Result<string, FileRefusal> => {
    call.signal.throwIfAborted();
    const absolute = absoluteOf(path);
    if (inside(absolute, state) && !inside(absolute, workspace)) {
      return err("walled");
    }
    if (call.workspaceOnly && !inside(absolute, workspace)) {
      return err("outside_workspace");
    }
    return isFolder(absolute) ? err("is_folder") : ok(absolute);
  };
  return {
    read: async (path, call): Promise<Result<ReadFile, FileRefusal>> => {
      const place = placeOf(path, call);
      const bytes = place.ok ? held.get(place.value) : undefined;
      if (!place.ok || bytes === undefined) {
        return Promise.resolve(place.ok ? err("not_found") : place);
      }
      return Promise.resolve(
        bytes.byteLength > call.maxBytes ? err("too_large") : ok({ path: place.value, bytes }),
      );
    },
    write: async (path, bytes, call) => {
      const place = placeOf(path, call);
      if (place.ok && call.createOnly === true && held.has(place.value)) {
        return Promise.resolve(err("exists"));
      }
      if (place.ok) {
        held.set(place.value, Uint8Array.from(bytes));
      }
      return Promise.resolve(place);
    },
    remove: async (path, call) => {
      const place = placeOf(path, call);
      if (place.ok && !held.delete(place.value)) {
        return Promise.resolve(err("not_found"));
      }
      return Promise.resolve(place);
    },
  };
}
