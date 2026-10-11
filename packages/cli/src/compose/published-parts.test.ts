import { describe, expect, it } from "vitest";
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

describe("publishedParts", () => {
  it("lets the public origin open sockets and opens the Mini App at its /mini", () => {
    const published = { ...remote, publicUrl: "https://owner.example.ts.net/" };
    expect(publishedParts({ engine, remote: published }, bot)).toStrictEqual({
      http: {
        host: "127.0.0.1",
        port: 7456,
        extraOrigins: ["https://console.example.invalid"],
        publicOrigin: "https://owner.example.ts.net",
      },
      telegram: { name: "bot", miniAppUrl: "https://owner.example.ts.net/mini" },
    });
  });

  it("adds nothing without a public address, and no bot without one", () => {
    const http = { host: "127.0.0.1", port: 7456, extraOrigins: engine.extraOrigins };
    expect([
      publishedParts({ engine, remote }, bot),
      publishedParts({ engine, remote: { ...remote, publicUrl: "https://x.ts.net" } }, undefined),
    ]).toStrictEqual([
      { http, telegram: bot },
      { http: { ...http, publicOrigin: "https://x.ts.net" } },
    ]);
  });
});
