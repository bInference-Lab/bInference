import { join } from "node:path";
import {
  ensurePrivateFolder,
  type FilePermissions,
  readTextFile,
  removePath,
  writePrivateFile,
} from "@binference/platform";
import { type ReleaseNotes, releaseNotesSchema } from "@binference/protocol";
import { z } from "zod";
import { updatesFolderOf } from "./announced-update.js";

/**
 * Where an update of `from` to `to` stands (decision 0356), in `updates/state.json`: `checking`
 * from the copy of the stopped state until the data on disk is the new version's after a pass, or
 * the old version's after a rollback, while every engine starts locked; it names the sealed backup
 * taken first. `updated` once it passed, with the release's notes for owners; `rolled_back` once
 * the old version and its data are back. The engine that starts next tells the owner of the last
 * two once and clears the record.
 */
export type UpdateState =
  | {
      readonly state: "checking";
      readonly from: string;
      readonly to: string;
      readonly backup?: string;
    }
  | {
      readonly state: "updated";
      readonly from: string;
      readonly to: string;
      readonly notes?: ReleaseNotes;
    }
  | { readonly state: "rolled_back"; readonly from: string; readonly to: string };

const version = z.string().min(1).max(64);

const updateStateSchema: z.ZodType<UpdateState> = z.discriminatedUnion("state", [
  z.object({
    state: z.literal("checking"),
    from: version,
    to: version,
    backup: z.string().min(1).max(128).exactOptional(),
  }),
  z.object({
    state: z.literal("updated"),
    from: version,
    to: version,
    notes: releaseNotesSchema.exactOptional(),
  }),
  z.object({ state: z.literal("rolled_back"), from: version, to: version }),
]);

function stateFileOf(stateRoot: string): string {
  return join(updatesFolderOf(stateRoot), "state.json");
}

/**
 * The update record: `undefined` when there is none, `unread` when a file is there that does not
 * read as one, such as one an interrupted write or another owner left, which counts as an update
 * still being checked.
 */
export async function readUpdateRecord(
  stateRoot: string,
  signal: AbortSignal,
): Promise<UpdateState | "unread" | undefined> {
  try {
    const read = await readTextFile(stateFileOf(stateRoot), signal);
    if (!read.ok) {
      return undefined;
    }
    const parsed = updateStateSchema.safeParse(JSON.parse(read.value));
    return parsed.success ? parsed.data : "unread";
  } catch {
    signal.throwIfAborted();
    return "unread";
  }
}

/** The update record, or none when it is missing or does not read. */
export async function readUpdateState(
  stateRoot: string,
  signal: AbortSignal,
): Promise<UpdateState | undefined> {
  const record = await readUpdateRecord(stateRoot, signal);
  return record === "unread" ? undefined : record;
}

/** Records where the update stands, owner-only, in place of the record before. */
export async function writeUpdateState(
  stateRoot: string,
  state: UpdateState,
  options: { readonly permissions: FilePermissions; readonly signal: AbortSignal },
): Promise<void> {
  await ensurePrivateFolder(updatesFolderOf(stateRoot), options);
  await writePrivateFile(stateFileOf(stateRoot), `${JSON.stringify(state)}\n`, options);
}

/** Removes the update record, once told or when an update ends. */
export async function clearUpdateState(stateRoot: string, signal: AbortSignal): Promise<void> {
  await removePath(stateFileOf(stateRoot), signal);
}

/**
 * Whether the record holds the engine locked (decision 0356): while an update is `checking`,
 * whatever version runs, the old one too, and while a record is there that does not read, so a
 * broken record fails closed.
 */
export async function isUpdateChecking(stateRoot: string, signal: AbortSignal): Promise<boolean> {
  const record = await readUpdateRecord(stateRoot, signal);
  return record === "unread" || record?.state === "checking";
}
