import { join } from "node:path";
import { BinferenceError, type Id, idSchema } from "@binference/core";
import {
  createManualClock,
  createMemoryLogger,
  createSeededRandom,
} from "@binference/core/testing";
import type { InstallBackupFacts, InstallStore } from "@binference/engine/install";
import { createMemoryBackupStore } from "@binference/engine/testing";
import {
  ensurePrivateFolder,
  type FilePermissions,
  resolveStateFolder,
  writePrivateFile,
} from "@binference/platform";
import { createTempFolder, type TempFolder } from "@binference/platform/testing";
import { noPermissions } from "../e2e/test-host.js";
import type { BackupParts } from "./backup-parts.js";

/** The install id of every test machine. */
export const installId: Id<"ins"> = idSchema("ins").parse(
  "ins_0190f1c2-3a4b-7c5d-8e6f-000000000001",
);
/** When a test machine's clock starts: a Monday's backup time, in UTC. */
export const nowMs: number = Date.parse("2026-10-12T03:30:00Z");
const signal = (): AbortSignal => new AbortController().signal;

function installOf(
  ownerKeyPublic: string | undefined,
): Pick<InstallStore, "installId" | "readBackupFacts"> {
  const facts: InstallBackupFacts = {
    wallets: [
      { custodyWalletId: "privy-wallet-1" },
      { custodyWalletId: "privy-wallet-2", archivedAtMs: 5 },
    ],
    ...(ownerKeyPublic === undefined
      ? {}
      : { custody: { appId: "privy-app", ownerKeyPublic, attachedAtMs: 1 } }),
  };
  return {
    installId: async () => Promise.resolve(installId),
    readBackupFacts: async () => Promise.resolve(facts),
  };
}

/** A state folder with a config and a workspace file, and the parts a backup of it takes. */
export interface BackupMachine {
  readonly parts: BackupParts;
  readonly clock: ReturnType<typeof createManualClock>;
  readonly root: string;
  readonly logger: ReturnType<typeof createMemoryLogger>;
}

/** How a test's machine differs from the default: no owner key unless one is given. */
export interface MachineOptions {
  readonly ownerKeyPublic?: string;
  readonly permissions?: FilePermissions;
  readonly snapshotFails?: boolean;
  /** The schema version `engine.sqlite` opened with; the build's own, 20, by default. */
  readonly schemaVersion?: number;
}

/** Makes a test machine in a fresh folder, handed to `folders` for cleanup. */
export async function backupMachine(
  folders: TempFolder[],
  options: MachineOptions,
): Promise<BackupMachine> {
  const folder = await createTempFolder("bnf-take-");
  folders.push(folder);
  const stateFolder = resolveStateFolder({ binferenceHome: folder.path });
  const files = { permissions: noPermissions, signal: signal() };
  await ensurePrivateFolder(join(stateFolder.workspace, "agent"), files);
  await writePrivateFile(stateFolder.configFile, "{ version: 4 }", files);
  await writePrivateFile(join(stateFolder.workspace, "agent", "notes.md"), "notes", files);
  const logger = createMemoryLogger({ subsystem: "engine" });
  const clock = createManualClock(nowMs);
  const parts: BackupParts = {
    stateFolder,
    engineDatabase: {
      schemaVersion: options.schemaVersion ?? 20,
      latestVersion: 20,
      vacuumInto: async (target) => {
        if (options.snapshotFails === true) {
          throw new BinferenceError({ code: "store.vacuum_failed", message: "disk" });
        }
        await writePrivateFile(target, Buffer.alloc(70_000, 3), files);
        return { ok: true, value: { file: target, bytes: 70_000 } };
      },
    },
    install: installOf(options.ownerKeyPublic),
    backups: createMemoryBackupStore(),
    permissions: options.permissions ?? noPermissions,
    clock,
    random: createSeededRandom(5),
    logger,
    binferenceVersion: "1.0.0",
    workerExecArgv: [],
  };
  return { parts, clock, root: folder.path, logger };
}
