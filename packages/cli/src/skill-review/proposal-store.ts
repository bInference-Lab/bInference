import { join } from "node:path";
import { type Id, isId } from "@binference/core";
import {
  ensurePrivateFolder,
  type FilePermissions,
  listFolderFiles,
  readTextFile,
  removePath,
  writePrivateFile,
} from "@binference/platform";
import { type ProposalRecord, proposalRecordSchema } from "./proposal-record.js";

/** The most ended proposals an agent keeps; the oldest past it are removed (decision 0408). */
const endedKept = 100;

/** Where the skill proposals are kept, one file each. */
export interface ProposalStoreOptions {
  /** The state folder's `skill-review/proposals/`. */
  readonly folder: string;
  readonly permissions: FilePermissions;
}

/** The agent's skill proposals as files, which the engine alone reads and writes. */
export interface ProposalStore {
  /** Writes the proposal whole in place of the one of its id. */
  put(record: ProposalRecord, signal: AbortSignal): Promise<void>;
  get(proposal: Id<"skp">, signal: AbortSignal): Promise<ProposalRecord | undefined>;
  /** Every proposal kept, the one changed last first. */
  list(signal: AbortSignal): Promise<readonly ProposalRecord[]>;
}

function parsed(text: string): ProposalRecord | undefined {
  try {
    const record = proposalRecordSchema.safeParse(JSON.parse(text));
    return record.success ? record.data : undefined;
  } catch {
    return undefined;
  }
}

// The ended proposals of the agent past the newest `endedKept`.
function pastKeeping(
  records: readonly ProposalRecord[],
  agent: Id<"agt">,
): readonly ProposalRecord[] {
  return records
    .filter((record) => record.agent === agent && record.status !== "pending")
    .slice(endedKept);
}

/**
 * Creates the {@link ProposalStore} over `skill-review/proposals/`, each proposal in
 * `<id>.json`, owner-only. A file that does not parse is left out. A write removes the agent's
 * ended proposals past the newest 100.
 */
export function createProposalStore(options: ProposalStoreOptions): ProposalStore {
  const fileOf = (proposal: Id<"skp">): string => join(options.folder, `${proposal}.json`);
  const read = async (proposal: Id<"skp">, signal: AbortSignal) => {
    const text = await readTextFile(fileOf(proposal), signal);
    return text.ok ? parsed(text.value) : undefined;
  };
  const list = async (signal: AbortSignal): Promise<readonly ProposalRecord[]> => {
    const names = await listFolderFiles(options.folder, signal);
    const ids = names.flatMap((name) => {
      const id = name.endsWith(".json") ? name.slice(0, -".json".length) : "";
      return isId("skp", id) ? [id] : [];
    });
    const records = await Promise.all(ids.map(async (id) => read(id, signal)));
    return records
      .filter((record) => record !== undefined)
      .toSorted((one, two) => two.updatedAt - one.updatedAt);
  };
  return {
    async put(record, signal) {
      const files = { permissions: options.permissions, signal };
      await ensurePrivateFolder(options.folder, files);
      await writePrivateFile(fileOf(record.proposal), `${JSON.stringify(record)}\n`, files);
      const gone = pastKeeping(await list(signal), record.agent);
      await Promise.all(gone.map(async ({ proposal }) => removePath(fileOf(proposal), signal)));
    },
    get: read,
    list,
  };
}
