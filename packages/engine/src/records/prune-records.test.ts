import { createManualClock } from "@binference/core/testing";
import { describe, expect, it } from "vitest";
import { fixtureHash, fixtureId } from "../contracts/store-fixtures.js";
import { createMemoryCredentialStore } from "../fakes/memory-credential-store.js";
import { createMemoryInboxStore } from "../fakes/memory-inbox-store.js";
import { createMemoryWebhookAlertStore } from "../fakes/memory-webhook-alert-store.js";
import {
  handledInboxKeptMs,
  pruneWorkOf,
  removedCredentialsKeptMs,
  webhookEventsKeptMs,
} from "./prune-records.js";

const live = { signal: new AbortController().signal };
const startMs = 1_760_000_000_000;

describe("the prune of records outside input grows", () => {
  it("deletes alerts older than 90 days and inbox entries handled more than 30 days ago", async () => {
    const clock = createManualClock(startMs);
    const inbox = createMemoryInboxStore();
    const webhookAlerts = createMemoryWebhookAlertStore({ inbox });
    const rule = {
      id: fixtureId("whr", 1),
      secretHash: fixtureHash("secret"),
      state: "active" as const,
      ratePerMinute: 60,
    };
    webhookAlerts.plant(rule);
    const alert = (receivedAtMs: number) => ({
      rule: rule.id,
      secretHash: rule.secretHash,
      body: { text: String(receivedAtMs) },
      bodyHash: fixtureHash(String(receivedAtMs)),
      receivedAtMs,
    });
    const old = await webhookAlerts.take(alert(startMs), live);
    await webhookAlerts.take(alert(startMs + webhookEventsKeptMs), live);
    expect(old).toMatchObject({ kind: "accepted" });
    const { entry } = old as { readonly entry: number };
    await inbox.markHandled({ id: entry, atMs: startMs }, live);
    const credentials = createMemoryCredentialStore();
    const prune = pruneWorkOf({ stores: { webhookAlerts, inbox, credentials }, clock });
    await clock.advance(handledInboxKeptMs);
    await expect(prune.pruneRecords(live)).resolves.toBe(0);
    await clock.advance(1);
    await expect(prune.pruneRecords(live)).resolves.toBe(1);
    await clock.advance(webhookEventsKeptMs);
    await expect(prune.pruneRecords(live)).resolves.toBe(1);
    const page = { keyPrefix: "wh:", limit: 10 };
    expect(await inbox.unhandled(page, live)).toHaveLength(1);
  });

  it("drops credentials removed more than 30 days ago", async () => {
    const clock = createManualClock(startMs);
    const inbox = createMemoryInboxStore();
    const credentials = createMemoryCredentialStore();
    const stores = { webhookAlerts: createMemoryWebhookAlertStore({ inbox }), inbox, credentials };
    await credentials.put({ name: "OLD_KEY", value: "v", allowedHosts: [], atMs: startMs }, live);
    await credentials.remove("OLD_KEY", { ...live, atMs: startMs });
    const prune = pruneWorkOf({ stores, clock });
    await clock.advance(removedCredentialsKeptMs);
    await expect(prune.pruneRecords(live)).resolves.toBe(0);
    await clock.advance(1);
    await expect(prune.pruneRecords(live)).resolves.toBe(1);
  });
});
