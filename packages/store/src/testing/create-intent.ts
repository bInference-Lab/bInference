import assert from "node:assert/strict";
import { type Id, idSchema } from "@binference/core";
import type { IntentDraft } from "@binference/engine";
import { createSqliteIntentStore } from "../intents/sqlite-intent-store.js";
import type { StoreHost } from "../tasks/store-host.js";
import type { PlantedAgent } from "./plant-agent.js";

/**
 * Creates intent `n` of a planted agent through the intent store, live and confirmed, for the rows
 * that name an intent.
 */
export async function createIntent(
  host: StoreHost,
  agent: PlantedAgent,
  n: number,
): Promise<Id<"int">> {
  const id = idSchema("int").parse(
    `int_0190f1c2-3a4b-7c5d-8e6f-${n.toString(16).padStart(12, "0")}`,
  );
  const draft: IntentDraft = {
    ...agent,
    id,
    kind: "swap",
    state: "confirmed",
    request: {},
    hasOutsideContent: false,
    isPaper: false,
    proposer: "engine",
    atMs: 1,
    cause: {},
  };
  const created = await createSqliteIntentStore(host).create(draft, {
    signal: new AbortController().signal,
  });
  assert.ok(created.ok);
  return id;
}
