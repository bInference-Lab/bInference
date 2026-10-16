import { describe, expect, it } from "vitest";
import type { RemoteConfig } from "../config/schema/operations.schema.js";
import { publishedParts } from "./published-parts.js";

const engine = {
  port: 7456,
  webhookPort: 7457,
  extraOrigins: ["https://console.example.invalid"],
  unlock: { mode: "file" },
  shutdownBudgetMs: 30_000,
} as const;
const remote = { mini: false, webhooks: false } as const;
const bot = { name: "bot" };

// The config cell of an engine that started with `published`, its extra origins as `held` says.
function settingsOf(
  published: RemoteConfig,
  held: { readonly origins: readonly string[] } = { origins: engine.extraOrigins },
) {
  return {
    started: { engine, remote: published },
    current: () => ({ engine: { extraOrigins: held.origins } }),
  };
}

describe("publishedParts", () => {
  it("lets the public origin open sockets and opens the Mini App at its /mini", () => {
    const published = { ...remote, publicUrl: "https://owner.example.ts.net/" };
    const parts = publishedParts(settingsOf(published), bot);
    expect([parts, parts.http.extraOrigins()]).toStrictEqual([
      {
        http: {
          host: "127.0.0.1",
          port: 7456,
          extraOrigins: parts.http.extraOrigins,
          publicOrigin: "https://owner.example.ts.net",
        },
        telegram: { name: "bot", miniAppUrl: "https://owner.example.ts.net/mini" },
      },
      ["https://console.example.invalid"],
    ]);
  });

  it("adds nothing without a public address, and no bot without one", () => {
    const local = publishedParts(settingsOf(remote), bot);
    const tunnelled = publishedParts(
      settingsOf({ ...remote, publicUrl: "https://x.ts.net" }),
      undefined,
    );
    const http = { host: "127.0.0.1", port: 7456 };
    expect([local, tunnelled]).toStrictEqual([
      { http: { ...http, extraOrigins: local.http.extraOrigins }, telegram: bot },
      {
        http: {
          ...http,
          extraOrigins: tunnelled.http.extraOrigins,
          publicOrigin: "https://x.ts.net",
        },
      },
    ]);
  });

  it("lets in the extra origins the config cell holds at each check", () => {
    const held: { origins: readonly string[] } = { origins: engine.extraOrigins };
    const { http } = publishedParts(settingsOf(remote, held), bot);
    held.origins = ["https://other.example.invalid"];
    expect(http.extraOrigins()).toStrictEqual(["https://other.example.invalid"]);
  });
});
