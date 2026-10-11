import {
  type LaunchClaim,
  launchClaimOutcomeSchema,
  launchClaimSchema,
  type LaunchClaimOutcome,
} from "@binference/engine/access";
import type { EngineTables } from "../databases/engine-tables.js";
import { createSyncKysely } from "../dialect/sync-kysely.js";
import { defineTask, type StoreTask } from "../tasks/store-task.js";

/**
 * Claims a Mini App launch in one transaction: deletes the claims from before `sinceMs`, then
 * answers `seen` for a hash still kept, or keeps the hash and answers `claimed`.
 */
export const claimLaunchTask: StoreTask<LaunchClaim, LaunchClaimOutcome> = defineTask({
  name: "access.claim_launch",
  access: "write",
  input: launchClaimSchema,
  output: launchClaimOutcomeSchema,
  run(database, claim) {
    const { kysely, execute, takeFirst } = createSyncKysely<EngineTables>(database);
    execute(kysely.deleteFrom("mini_app_launches").where("seen_at", "<", claim.sinceMs));
    const kept = takeFirst(
      kysely
        .selectFrom("mini_app_launches")
        .select("launch_hash")
        .where("launch_hash", "=", claim.launchHash),
    );
    if (kept !== undefined) {
      return "seen";
    }
    execute(
      kysely
        .insertInto("mini_app_launches")
        .values({ launch_hash: claim.launchHash, seen_at: claim.atMs }),
    );
    return "claimed";
  },
});
