import { join } from "node:path";
import type { EngineCaller, EnginePush } from "@binference/engine";
import type { TempFolder } from "@binference/platform/testing";
import { jobDonePushSchema, jobFailedPushSchema } from "@binference/protocol";
import { afterEach, describe, expect, it } from "vitest";
import { testOwnerKey } from "../backups/backup-fixtures.js";
import { backupMachine, type MachineOptions } from "../backups/backup-machine.js";
import { currentConfigVersion } from "../config/migrations/config-migrations.js";
import { configSchema } from "../config/schema/config.schema.js";
import { createBackupOperations } from "./backup-operations.js";
import { createClosers } from "./closers.js";
import { createConfigCell } from "./config-cell.js";

const folders: TempFolder[] = [];
const live = { signal: new AbortController().signal };
const cli: EngineCaller = {
  credential: "tok_0190f1c2-3a4b-7c5d-8e6f-000000000001",
  client: { kind: "cli", version: "test" },
  scopes: ["read", "admin"],
  transport: "ipc",
};
const config = configSchema.parse({
  version: currentConfigVersion,
  telegram: { botToken: { fromEnv: "TEST_BOT_TOKEN" } },
});

afterEach(async () => {
  await Promise.all(folders.splice(0).map(async (folder) => folder.remove()));
});

async function operationsOn(options: MachineOptions & { readonly hasOwnerKey?: boolean }) {
  const owner =
    options.hasOwnerKey === false ? {} : { ownerKeyPublic: (await testOwnerKey()).publicKey };
  const machine = await backupMachine(folders, { ...options, ...owner });
  const pushes: EnginePush[] = [];
  const pushed: { next: () => void } = { next: () => undefined };
  const closers = createClosers();
  const handlers = createBackupOperations({
    parts: machine.parts,
    settings: createConfigCell(config),
    publish: (push) => {
      pushes.push(push);
      pushed.next();
    },
    closers,
  });
  const { "backup/create": create, "backup/list": list } = handlers;
  if (create === undefined || list === undefined) {
    throw new Error("Expected the backup handlers.");
  }
  const nextPush = async (): Promise<EnginePush> =>
    new Promise((resolve) => {
      pushed.next = () => {
        const [push] = pushes.splice(0);
        if (push !== undefined) {
          resolve(push);
        }
      };
    });
  return {
    machine,
    closers,
    nextPush,
    create: async (copyTo?: string) =>
      create({ args: copyTo === undefined ? {} : { copyTo }, caller: cli, ...live }),
    list: async () => list({ args: {}, caller: cli, ...live }),
  };
}

describe("the backup operations", () => {
  it("takes a backup by hand as a job, ends it on the job topic, and lists it first", async () => {
    const backups = await operationsOn({});
    const ended = backups.nextPush();

    const started = await backups.create();
    const again = await backups.create();
    const push = await ended;

    expect(again).toStrictEqual(started);
    expect(push).toMatchObject({ topic: "job", kind: "job/done" });
    const done = jobDonePushSchema.parse(push.data);
    expect(done).toMatchObject({ op: "backup/create", result: { kind: "manual" } });
    expect(await backups.list()).toStrictEqual({ ok: true, value: { items: [done.result] } });
    expect(done.result).toHaveProperty("verifiedAt");
  });

  it("ends the job failed with the step that failed", async () => {
    const backups = await operationsOn({ snapshotFails: true });
    const ended = backups.nextPush();

    await backups.create();
    const push = await ended;

    expect(push.kind).toBe("job/failed");
    expect(jobFailedPushSchema.parse(push.data).error).toMatchObject({
      code: "backup.snapshot_failed",
      retryable: true,
    });
  });

  it("says an install with no owner key has nothing to seal a backup to", async () => {
    const backups = await operationsOn({ hasOwnerKey: false });
    const ended = backups.nextPush();

    await backups.create();

    expect(jobFailedPushSchema.parse((await ended).data).error).toMatchObject({
      code: "backup.no_owner_key",
      retryable: false,
    });
  });

  it("refuses a second copy in a folder that is not absolute, and copies to one that is", async () => {
    const backups = await operationsOn({});
    expect(await backups.create("relative/folder")).toStrictEqual({
      ok: false,
      error: "protocol.bad_args",
    });
    const ended = backups.nextPush();
    await backups.create(join(backups.machine.root, "copies"));
    expect((await ended).kind).toBe("job/done");
  });

  it("stops a job under way with the engine, and says nothing of it", async () => {
    const backups = await operationsOn({});
    const pushes: EnginePush[] = [];
    void backups.nextPush().then((push) => pushes.push(push));

    await backups.create();
    await backups.closers.closeAll(live.signal);

    expect(pushes).toStrictEqual([]);
  });
});
