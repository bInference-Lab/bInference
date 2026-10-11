import { createSecret, type HttpResponse } from "@binference/core";
import { createManualClock, createScriptedHttp } from "@binference/core/testing";
import { describe, expect, it } from "vitest";
import { aggregationsOf } from "../ceiling/day-caps.js";
import { testCapPlan } from "../testing/custody-fixtures.js";
import { createAggregation, deleteAggregation } from "./aggregations.js";
import { privySettings } from "./privy-client.js";
import type { PrivyId } from "./privy-records.js";

const owner = "ownerquorum0000000000000" as PrivyId;
const url = "https://api.privy.io/v1/aggregations";
function nativeDefinition() {
  const listed = aggregationsOf(testCapPlan);
  const [native] = listed.ok ? listed.value : [];
  if (native === undefined) {
    throw new Error("Expected the native cap's aggregation.");
  }
  return native;
}

const native = nativeDefinition();

function answer(status: number, body: object): HttpResponse {
  return { status, headers: { "content-type": "application/json" }, body: JSON.stringify(body) };
}

function settingsOver(response: HttpResponse) {
  const http = createScriptedHttp([{ method: "POST", url, response }]);
  const settings = privySettings({
    http,
    clock: createManualClock(0),
    appId: "app-id",
    appSecret: createSecret("privy-secret-value-1234"),
  });
  return { http, settings };
}

const made = {
  id: "aggregation0000000000001",
  owner_id: owner,
  window: { type: "rolling", seconds: 86_400 },
  name: "x",
};

describe("createAggregation", () => {
  it("posts the aggregation with the app's Basic auth and answers its id", async () => {
    const { http, settings } = settingsOver(answer(200, made));
    const id = await createAggregation(
      settings,
      { definition: native, owner },
      AbortSignal.timeout(5_000),
    );
    const [sent] = http.requests();

    expect(id).toBe(made.id);
    expect(sent?.headers?.["privy-app-id"]).toBe("app-id");
    expect(sent?.headers?.["authorization"]).toMatch(/^Basic /);
    expect(JSON.parse(String(sent?.body))).toStrictEqual({
      name: "binference native sent, chain 56",
      method: "eth_signTransaction",
      metric: { field: "value", field_source: "ethereum_transaction", function: "sum" },
      window: { type: "rolling", seconds: 86_400 },
      conditions: [
        { field_source: "ethereum_transaction", field: "chain_id", operator: "eq", value: "56" },
      ],
      owner_id: owner,
    });
  });

  it.each([
    ["custody.privy_busy", answer(429, { error: "Too many requests" })],
    ["custody.privy_credentials", answer(401, { error: "Invalid app ID or app secret." })],
    ["custody.privy_refused", answer(400, { error: "Invalid body." })],
    ["custody.privy_failed", answer(500, { error: "Internal error." })],
    ["custody.privy_malformed", answer(200, { ...made, owner_id: "anotherquorum00000000000" })],
    ["custody.privy_malformed", answer(200, { id: made.id })],
  ])("throws %s for an answer it cannot take", async (code, response) => {
    const { settings } = settingsOver(response);
    await expect(
      createAggregation(settings, { definition: native, owner }, AbortSignal.timeout(5_000)),
    ).rejects.toMatchObject({ code });
  });

  it("throws as unreachable when no answer comes, and never names the secret", async () => {
    const settings = privySettings({
      http: createScriptedHttp([]),
      clock: createManualClock(0),
      appId: "app-id",
      appSecret: createSecret("privy-secret-value-1234"),
    });
    const thrown = await createAggregation(
      settings,
      { definition: native, owner },
      AbortSignal.timeout(5_000),
    ).catch((error: unknown) => error);

    expect(thrown).toMatchObject({ code: "custody.privy_unreachable" });
    expect(JSON.stringify(thrown)).not.toContain("privy-secret-value-1234");
  });
});

function deleteOver(response: HttpResponse) {
  const http = createScriptedHttp([{ method: "DELETE", url: `${url}/${made.id}`, response }]);
  const settings = privySettings({
    http,
    clock: createManualClock(0),
    appId: "app-id",
    appSecret: createSecret("privy-secret-value-1234"),
  });
  return { http, settings };
}

describe("deleteAggregation", () => {
  it("deletes the aggregation with the app's Basic auth and no body", async () => {
    const { http, settings } = deleteOver(answer(200, { success: true }));
    const deleted = await deleteAggregation(
      settings,
      made.id as PrivyId,
      AbortSignal.timeout(5_000),
    );
    const [sent] = http.requests();

    expect(deleted).toStrictEqual({ ok: true, value: undefined });
    expect(sent?.headers?.["authorization"]).toMatch(/^Basic /);
    expect(sent?.body).toBeUndefined();
  });

  it("answers not_found for one Privy does not hold", async () => {
    const { settings } = deleteOver(answer(404, { error: "Not found." }));
    await expect(
      deleteAggregation(settings, made.id as PrivyId, AbortSignal.timeout(5_000)),
    ).resolves.toStrictEqual({ ok: false, error: "not_found" });
  });

  it.each([
    ["custody.privy_busy", answer(429, { error: "Too many requests" })],
    ["custody.privy_credentials", answer(401, { error: "Invalid app ID or app secret." })],
    ["custody.privy_failed", answer(500, { error: "Internal error." })],
  ])("throws %s for an answer it cannot take", async (code, response) => {
    const { settings } = deleteOver(response);
    await expect(
      deleteAggregation(settings, made.id as PrivyId, AbortSignal.timeout(5_000)),
    ).rejects.toMatchObject({ code });
  });
});
