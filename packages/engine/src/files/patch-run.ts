import { err, ok, type Result } from "@binference/core";
import type { ResultOf } from "@binference/protocol";
import type { FileCall } from "./file-records.js";
import { readText } from "./file-text.js";
import { applyHunks } from "./patch-apply.js";
import { parsePatch, type PatchOperation } from "./patch-parse.js";
import type { FileRefusal, MachineFiles } from "./ports.js";

type PatchedFile = ResultOf<"file/patch">["files"][number];

/** One write or removal a patch makes once every change is known. */
type Action =
  | {
      readonly kind: "write";
      readonly path: string;
      readonly text: string;
      readonly createOnly: boolean;
    }
  | { readonly kind: "remove"; readonly path: string };

/** The planned actions, and what the result names for each file operation. */
interface Plan {
  readonly actions: readonly Action[];
  readonly changes: readonly {
    readonly path: string;
    readonly change: PatchedFile["change"];
    readonly to?: string;
  }[];
}

const refusalWords: Readonly<Record<FileRefusal | "binary", string>> = {
  not_found: "there is no such file",
  walled: "it is inside binference's own folder",
  outside_workspace: "it is outside the agent's workspace, where patches stay",
  too_large: "the file is over 10 MiB",
  is_folder: "it is a folder",
  unreadable: "the file could not be read",
  unwritable: "the file could not be written",
  exists: "a file is already there; delete it first in the same patch",
  skill_folder: "it is in a workspace skills folder, which changes only through skill_proposal",
  changed: "the path led elsewhere while it was checked; read it again",
  binary: "the file is not text",
};

/** The files a patch has seen so far: their text as the patch leaves it, `null` once removed. */
type Seen = Map<string, string | null>;

/** What planning reads through, and the files it has seen. */
interface Context {
  readonly files: MachineFiles;
  readonly call: FileCall;
  readonly seen: Seen;
}

async function currentText(context: Context, path: string): Promise<Result<string, string>> {
  const seen = context.seen.get(path);
  if (seen !== undefined) {
    return seen === null ? err(`${path}: ${refusalWords.not_found}`) : ok(seen);
  }
  const read = await readText(context.files, path, context.call);
  return read.ok
    ? ok(read.value.bom + read.value.text)
    : err(`${path}: ${refusalWords[read.error]}`);
}

// A path the patch may create: nothing there now, or a file the patch removed before.
async function mayCreate(context: Context, path: string): Promise<Result<true, string>> {
  const seen = context.seen.get(path);
  if (seen !== undefined) {
    return seen === null ? ok(true) : err(`${path}: ${refusalWords.exists}`);
  }
  const read = await context.files.read(path, { ...context.call, maxBytes: 0 });
  if (!read.ok && read.error === "not_found") {
    return ok(true);
  }
  return err(
    `${path}: ${read.ok || read.error === "too_large" ? refusalWords.exists : refusalWords[read.error]}`,
  );
}

// Plans one operation against what the patch has seen, and records what it leaves.
async function planOne(context: Context, operation: PatchOperation): Promise<Result<Plan, string>> {
  if (operation.kind === "add") {
    const free = await mayCreate(context, operation.path);
    if (!free.ok) {
      return free;
    }
    const text = operation.lines.length === 0 ? "" : `${operation.lines.join("\n")}\n`;
    context.seen.set(operation.path, text);
    const action: Action = { kind: "write", path: operation.path, text, createOnly: true };
    return ok({ actions: [action], changes: [{ path: operation.path, change: "added" }] });
  }
  const current = await currentText(context, operation.path);
  if (!current.ok) {
    return current;
  }
  if (operation.kind === "delete") {
    context.seen.set(operation.path, null);
    return ok({
      actions: [{ kind: "remove", path: operation.path }],
      changes: [{ path: operation.path, change: "deleted" }],
    });
  }
  return planUpdate(context, { ...operation, current: current.value });
}

async function planUpdate(
  context: Context,
  update: Extract<PatchOperation, { readonly kind: "update" }> & { readonly current: string },
): Promise<Result<Plan, string>> {
  const changed = applyHunks(update.current, update.hunks, update.path);
  if (!changed.ok) {
    return changed;
  }
  const text = changed.value;
  const to = update.moveTo;
  if ((to === undefined || to === update.path) && text === update.current) {
    // A change that leaves the file as it was writes nothing and is not named.
    return ok({ actions: [], changes: [] });
  }
  if (to === undefined || to === update.path) {
    context.seen.set(update.path, text);
    const action: Action = { kind: "write", path: update.path, text, createOnly: false };
    return ok({ actions: [action], changes: [{ path: update.path, change: "updated" }] });
  }
  const free = await mayCreate(context, to);
  if (!free.ok) {
    return free;
  }
  context.seen.set(to, text);
  context.seen.set(update.path, null);
  const actions: readonly Action[] = [
    { kind: "write", path: to, text, createOnly: true },
    { kind: "remove", path: update.path },
  ];
  return ok({ actions, changes: [{ path: update.path, change: "moved", to }] });
}

/** What running a patch gives: the files it changed, or why it changed nothing. */
export type PatchRun = ResultOf<"file/patch">;

async function planAll(
  context: Context,
  operations: readonly PatchOperation[],
): Promise<Result<Plan, string>> {
  const actions: Action[] = [];
  const changes: Plan["changes"][number][] = [];
  for (const operation of operations) {
    // oxlint-disable-next-line eslint/no-await-in-loop -- each operation reads what the ones before left
    const planned = await planOne(context, operation);
    if (!planned.ok) {
      return planned;
    }
    actions.push(...planned.value.actions);
    changes.push(...planned.value.changes);
  }
  return ok({ actions, changes });
}

const encoder = new TextEncoder();

// Writes and removes in the patch's order, keeping each file's absolute path as the files answer it.
async function runActions(
  files: MachineFiles,
  actions: readonly Action[],
  call: FileCall,
): Promise<Result<ReadonlyMap<string, string>, string>> {
  const absolute = new Map<string, string>();
  for (const action of actions) {
    const done =
      action.kind === "write"
        ? // oxlint-disable-next-line eslint/no-await-in-loop -- the patch's order is the files' order
          await files.write(action.path, encoder.encode(action.text), {
            ...call,
            createOnly: action.createOnly,
          })
        : // oxlint-disable-next-line eslint/no-await-in-loop -- the patch's order is the files' order
          await files.remove(action.path, call);
    if (!done.ok) {
      const earlier = absolute.size === 0 ? "" : "; the files before it were changed";
      return err(`${action.path}: ${refusalWords[done.error]}${earlier}`);
    }
    absolute.set(action.path, done.value);
  }
  return ok(absolute);
}

/**
 * Runs a patch over the machine's files (decision 0386): it reads the patch, plans every file
 * operation against the files as they are and as the patch leaves them, and writes nothing until
 * every change is found. An added file or a move's destination must be free, unless the patch
 * removed it before. A patch that cannot be read or placed answers why and changes nothing.
 */
export async function runPatch(
  files: MachineFiles,
  input: string,
  call: FileCall,
): Promise<PatchRun> {
  const operations = parsePatch(input);
  if (!operations.ok) {
    return { files: [], problem: `The patch cannot be read: ${operations.error}.` };
  }
  const context: Context = { files, call, seen: new Map() };
  const plan = await planAll(context, operations.value);
  if (!plan.ok) {
    return { files: [], problem: `The patch changed nothing: ${plan.error}.` };
  }
  const ran = await runActions(files, plan.value.actions, call);
  if (!ran.ok) {
    return { files: [], problem: `The patch stopped: ${ran.error}.` };
  }
  const where = (path: string): string => ran.value.get(path) ?? path;
  return {
    files: plan.value.changes.map(({ path, change, to }): PatchedFile => {
      const at = where(path);
      return to === undefined ? { path: at, change } : { path: at, change, to: where(to) };
    }),
  };
}
