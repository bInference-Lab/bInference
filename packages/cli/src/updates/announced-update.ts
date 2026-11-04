import { join } from "node:path";
import {
  ensurePrivateFolder,
  type FilePermissions,
  readTextFile,
  writePrivateFile,
} from "@binference/platform";
import { z } from "zod";
import type { ReleaseChannel } from "./release-feed.js";

/** The release the update notice told the owner of last, on its channel (decision 0355). */
export interface AnnouncedUpdate {
  readonly channel: ReleaseChannel;
  readonly version: string;
}

const announcedSchema: z.ZodType<AnnouncedUpdate> = z.object({
  channel: z.enum(["stable", "beta"]),
  version: z.string().min(1).max(64),
});

/** The state folder's `updates/`, owner-only: what the update check and `update` keep. */
export function updatesFolderOf(stateRoot: string): string {
  return join(stateRoot, "updates");
}

function announcedFileOf(stateRoot: string): string {
  return join(updatesFolderOf(stateRoot), "announced.json");
}

/** The release announced last, from `updates/announced.json`; none when it is missing or unread. */
export async function readAnnouncedUpdate(
  stateRoot: string,
  signal: AbortSignal,
): Promise<AnnouncedUpdate | undefined> {
  const read = await readTextFile(announcedFileOf(stateRoot), signal);
  if (!read.ok) {
    return undefined;
  }
  try {
    const parsed = announcedSchema.safeParse(JSON.parse(read.value));
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

/** Records the release announced, owner-only, in place of the one before. */
export async function writeAnnouncedUpdate(
  stateRoot: string,
  announced: AnnouncedUpdate,
  options: { readonly permissions: FilePermissions; readonly signal: AbortSignal },
): Promise<void> {
  await ensurePrivateFolder(updatesFolderOf(stateRoot), options);
  await writePrivateFile(announcedFileOf(stateRoot), `${JSON.stringify(announced)}\n`, options);
}
